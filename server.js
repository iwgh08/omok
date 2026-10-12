const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Renju = require('./shared/renju');

const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = 30 * 1000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const TOTAL_TIMES = [300, 600, 1200]; // 각자 주어지는 총 시간(초)
const CENTER = Math.floor(Renju.SIZE / 2);
const COLOR_NAME = { 1: '흑', 2: '백' };
const REASON_TEXT = {
  five: '5목 완성',
  timeout: '시간 초과',
  resign: '기권',
  disconnect: '연결 끊김',
  leave: '대국 중 퇴장',
  draw: '판이 가득 참',
};

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
const server = http.createServer(app);
const io = new Server(server);

/**
 * room = {
 *   code, totalTime(초), status: 'waiting' | 'playing' | 'ended',
 *   seats: [seat|null, seat|null], seat = { clientId, name, socketId, connected, graceTimer }
 *   blackSeat: 0|1|null, board, moves: [[x,y]], turn: 1|2, winner: 1|2|0|null, reason,
 *   clocks: { 1: ms, 2: ms }, turnStartedAt, turnTimer, undoRequest: 1|2|null, rematch: Set<seatIdx>,
 *   members: Map<socketId, { clientId, name }>, chat: [], deleteTimer
 * }
 */
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').trim().slice(0, 12);
  return n || '익명';
}

function seatColor(room, idx) {
  if (room.blackSeat === null || idx < 0) return 0;
  return idx === room.blackSeat ? Renju.BLACK : Renju.WHITE;
}

function seatOfColor(room, color) {
  if (room.blackSeat === null) return -1;
  return color === Renju.BLACK ? room.blackSeat : 1 - room.blackSeat;
}

function seatIndexOf(room, clientId) {
  return room.seats.findIndex((s) => s && s.clientId === clientId);
}

function stateFor(room, socketId) {
  const member = room.members.get(socketId);
  const mySeat = member ? seatIndexOf(room, member.clientId) : -1;
  const seatedIds = new Set(room.seats.filter(Boolean).map((s) => s.clientId));
  return {
    code: room.code,
    totalTime: room.totalTime,
    status: room.status,
    board: room.board,
    moves: room.moves,
    turn: room.turn,
    winner: room.winner,
    reason: room.reason,
    clocks: { 1: remainingOf(room, Renju.BLACK), 2: remainingOf(room, Renju.WHITE) },
    seats: room.seats.map((s, i) => s && { name: s.name, connected: s.connected, color: seatColor(room, i) }),
    spectators: [...room.members.values()].filter((m) => !seatedIds.has(m.clientId)).map((m) => m.name),
    undoRequest: room.undoRequest,
    rematch: [...room.rematch],
    you: { seat: mySeat, color: seatColor(room, mySeat) },
  };
}

function broadcast(room) {
  for (const socketId of room.members.keys()) {
    io.to(socketId).emit('state', stateFor(room, socketId));
  }
}

function addChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > 100) room.chat.shift();
  io.to(room.code).emit('chat', msg);
}

function system(room, text) {
  addChat(room, { system: true, text });
}

// 체스 시계: 각자 총 시간을 갖고, 자기 차례에만 줄어든다
function remainingOf(room, color) {
  let ms = room.clocks[color];
  if (room.turnStartedAt && color === room.turn) ms -= Date.now() - room.turnStartedAt;
  return Math.max(0, ms);
}

function startClock(room) {
  clearTimeout(room.turnTimer);
  room.turnStartedAt = Date.now();
  room.turnTimer = setTimeout(() => {
    if (room.status !== 'playing') return;
    const loser = room.turn;
    room.clocks[loser] = 0;
    room.turnStartedAt = null;
    endGame(room, loser === Renju.BLACK ? Renju.WHITE : Renju.BLACK, 'timeout');
  }, room.clocks[room.turn] + 300); // 네트워크 지연 여유
}

// 현재 차례 플레이어가 쓴 시간을 시계에서 빼고 멈춤
function stopClock(room) {
  clearTimeout(room.turnTimer);
  if (!room.turnStartedAt) return;
  room.clocks[room.turn] = remainingOf(room, room.turn);
  room.turnStartedAt = null;
}

function newGame(room) {
  room.board = Renju.createBoard();
  room.moves = [];
  room.turn = Renju.BLACK;
  room.status = 'playing';
  room.winner = null;
  room.reason = null;
  room.undoRequest = null;
  room.rematch.clear();
  room.clocks = { 1: room.totalTime * 1000, 2: room.totalTime * 1000 };
  startClock(room);
  const black = room.seats[room.blackSeat].name;
  const white = room.seats[1 - room.blackSeat].name;
  system(room, `새 대국 시작! 흑: ${black}, 백: ${white}`);
}

function endGame(room, winner, reason) {
  stopClock(room);
  room.status = 'ended';
  room.winner = winner;
  room.reason = reason;
  room.undoRequest = null;
  room.rematch.clear();
  if (winner) {
    const name = room.seats[seatOfColor(room, winner)]?.name ?? COLOR_NAME[winner];
    system(room, `${COLOR_NAME[winner]}(${name}) 승리 — ${REASON_TEXT[reason]}`);
  } else {
    system(room, `무승부 — ${REASON_TEXT[reason]}`);
  }
  broadcast(room);
}

// 빈 자리에 관전자를 올리고, 두 자리가 차면 대국 시작
function fillSeats(room) {
  if (room.status === 'playing') return;
  const seatedIds = () => new Set(room.seats.filter(Boolean).map((s) => s.clientId));
  for (let i = 0; i < 2; i++) {
    if (room.seats[i]) continue;
    const ids = seatedIds();
    const next = [...room.members.entries()].find(([, m]) => !ids.has(m.clientId));
    if (!next) break;
    const [socketId, m] = next;
    room.seats[i] = { clientId: m.clientId, name: m.name, socketId, connected: true, graceTimer: null };
    system(room, `${m.name} 님이 대국자로 참가했습니다`);
  }
  if (room.seats[0] && room.seats[1] && room.status === 'waiting') {
    room.blackSeat = room.blackSeat === null ? Math.floor(Math.random() * 2) : 1 - room.blackSeat;
    newGame(room);
  }
}

function freeSeat(room, idx) {
  const seat = room.seats[idx];
  if (!seat) return;
  clearTimeout(seat.graceTimer);
  room.seats[idx] = null;
  room.rematch.delete(idx);
  if (room.status === 'ended') room.status = 'waiting';
  fillSeats(room);
}

function scheduleRoomCleanup(room) {
  clearTimeout(room.deleteTimer);
  if (room.members.size > 0) return;
  room.deleteTimer = setTimeout(() => {
    if (room.members.size > 0) return;
    clearTimeout(room.turnTimer);
    room.seats.forEach((s) => s && clearTimeout(s.graceTimer));
    rooms.delete(room.code);
  }, EMPTY_ROOM_TTL_MS);
}

function createRoom(totalTime) {
  const room = {
    code: makeCode(),
    totalTime: TOTAL_TIMES.includes(totalTime) ? totalTime : 600,
    status: 'waiting',
    seats: [null, null],
    blackSeat: null,
    board: Renju.createBoard(),
    moves: [],
    turn: Renju.BLACK,
    winner: null,
    reason: null,
    clocks: { 1: 0, 2: 0 },
    turnStartedAt: null,
    turnTimer: null,
    undoRequest: null,
    rematch: new Set(),
    members: new Map(),
    chat: [],
    deleteTimer: null,
  };
  rooms.set(room.code, room);
  scheduleRoomCleanup(room);
  return room;
}

io.on('connection', (socket) => {
  let room = null;

  const me = () => room && room.members.get(socket.id);
  const mySeatIdx = () => (me() ? seatIndexOf(room, me().clientId) : -1);
  const myColor = () => seatColor(room, mySeatIdx());
  const fail = (msg) => socket.emit('errorMsg', msg);

  function leaveCurrent(intentional) {
    if (!room) return;
    const r = room;
    const member = r.members.get(socket.id);
    r.members.delete(socket.id);
    socket.leave(r.code);
    room = null;
    if (!member) return;
    const idx = seatIndexOf(r, member.clientId);
    const seat = r.seats[idx];
    if (seat && seat.socketId === socket.id) {
      if (intentional) {
        if (r.status === 'playing') endGame(r, seatColor(r, idx) === Renju.BLACK ? Renju.WHITE : Renju.BLACK, 'leave');
        system(r, `${member.name} 님이 나갔습니다`);
        freeSeat(r, idx);
      } else {
        seat.connected = false;
        system(r, `${member.name} 님의 연결이 끊겼습니다 (30초 안에 돌아오지 않으면 자리를 잃습니다)`);
        seat.graceTimer = setTimeout(() => {
          const i = r.seats.indexOf(seat);
          if (i < 0 || seat.connected) return;
          if (r.status === 'playing') endGame(r, seatColor(r, i) === Renju.BLACK ? Renju.WHITE : Renju.BLACK, 'disconnect');
          freeSeat(r, i);
          broadcast(r);
        }, RECONNECT_GRACE_MS);
      }
    } else if (idx < 0) {
      system(r, `관전자 ${member.name} 님이 나갔습니다`);
    }
    broadcast(r);
    scheduleRoomCleanup(r);
  }

  function join(code, name, clientId) {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return { ok: false, error: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' };
    leaveCurrent(true);
    room = r;
    clearTimeout(r.deleteTimer);

    // 같은 브라우저의 이전 접속(다른 탭 등)은 정리
    for (const [sid, m] of r.members) {
      if (m.clientId === clientId) {
        r.members.delete(sid);
        io.sockets.sockets.get(sid)?.leave(r.code);
        io.to(sid).emit('kicked', '다른 탭에서 같은 방에 접속했습니다.');
      }
    }
    r.members.set(socket.id, { clientId, name });
    socket.join(r.code);

    const idx = seatIndexOf(r, clientId);
    if (idx >= 0) {
      const seat = r.seats[idx];
      clearTimeout(seat.graceTimer);
      seat.socketId = socket.id;
      seat.name = name;
      if (!seat.connected) system(r, `${name} 님이 다시 접속했습니다`);
      seat.connected = true;
    } else {
      system(r, `${name} 님이 입장했습니다`);
      fillSeats(r);
      if (seatIndexOf(r, clientId) < 0) system(r, `${name} 님은 관전 중입니다`);
    }
    socket.emit('chatHistory', r.chat);
    broadcast(r);
    return { ok: true, code: r.code };
  }

  // 주의: 클라이언트가 null 등을 보내도 서버가 죽지 않도록 `data || {}`로 꺼낸다
  socket.on('createRoom', (data, cb) => {
    const { name, clientId, totalTime } = data || {};
    if (typeof cb !== 'function' || !clientId) return;
    const r = createRoom(Number(totalTime));
    cb(join(r.code, cleanName(name), String(clientId)));
  });

  socket.on('joinRoom', (data, cb) => {
    const { code, name, clientId } = data || {};
    if (typeof cb !== 'function' || !clientId) return;
    cb(join(code, cleanName(name), String(clientId)));
  });

  socket.on('leaveRoom', () => leaveCurrent(true));
  socket.on('disconnect', () => leaveCurrent(false));

  socket.on('place', (data) => {
    const { x, y } = data || {};
    if (!room || room.status !== 'playing') return;
    const color = myColor();
    if (!color) return fail('관전자는 돌을 둘 수 없습니다.');
    if (color !== room.turn) return fail('상대 차례입니다.');
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Renju.SIZE || y >= Renju.SIZE) return;
    const i = y * Renju.SIZE + x;
    if (room.board[i] !== Renju.EMPTY) return fail('이미 돌이 있는 자리입니다.');
    if (room.moves.length === 0 && (x !== CENTER || y !== CENTER)) return fail('흑의 첫 수는 정중앙(천원)에 두어야 합니다.');
    if (color === Renju.BLACK) {
      const type = Renju.forbiddenType(room.board, x, y);
      if (type) return fail(`${Renju.FORBIDDEN_NAMES[type]} 자리입니다.`);
    }

    stopClock(room);
    room.board[i] = color;
    room.moves.push([x, y]);
    room.undoRequest = null;
    io.to(room.code).emit('stonePlaced');

    if (Renju.isWin(room.board, x, y, color)) return endGame(room, color, 'five');
    if (room.moves.length === Renju.SIZE * Renju.SIZE) return endGame(room, 0, 'draw');
    room.turn = color === Renju.BLACK ? Renju.WHITE : Renju.BLACK;
    startClock(room);
    broadcast(room);
  });

  socket.on('undoRequest', () => {
    if (!room || room.status !== 'playing') return;
    const color = myColor();
    if (!color) return;
    if (room.undoRequest) return fail('이미 무르기 요청이 진행 중입니다.');
    const myMoves = room.moves.filter((_, i) => (i % 2 === 0 ? Renju.BLACK : Renju.WHITE) === color).length;
    if (myMoves === 0 || (color === Renju.BLACK && myMoves === 1)) return fail('무를 수 있는 수가 없습니다.');
    room.undoRequest = color;
    system(room, `${me().name} 님이 무르기를 요청했습니다`);
    broadcast(room);
  });

  socket.on('undoReply', (data) => {
    const { accept } = data || {};
    if (!room || room.status !== 'playing' || !room.undoRequest) return;
    const color = myColor();
    if (!color || color === room.undoRequest) return;
    const requester = room.undoRequest;
    room.undoRequest = null;
    if (!accept) {
      system(room, '무르기 요청이 거절되었습니다');
      return broadcast(room);
    }
    // 요청자의 마지막 수까지 되돌림 (상대 차례면 1수, 내 차례면 2수)
    const count = room.turn === requester ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const [x, y] = room.moves.pop();
      room.board[y * Renju.SIZE + x] = Renju.EMPTY;
    }
    stopClock(room);
    room.turn = requester;
    startClock(room);
    system(room, `무르기가 수락되어 ${count}수를 되돌렸습니다`);
    broadcast(room);
  });

  socket.on('resign', () => {
    if (!room || room.status !== 'playing') return;
    const color = myColor();
    if (!color) return;
    endGame(room, color === Renju.BLACK ? Renju.WHITE : Renju.BLACK, 'resign');
  });

  socket.on('rematch', () => {
    if (!room || room.status !== 'ended') return;
    const idx = mySeatIdx();
    if (idx < 0) return;
    room.rematch.add(idx);
    if (room.seats[0] && room.seats[1] && room.rematch.size === 2) {
      room.blackSeat = 1 - room.blackSeat; // 흑백 교대
      newGame(room);
    } else {
      system(room, `${me().name} 님이 재대국을 원합니다`);
    }
    broadcast(room);
  });

  socket.on('chat', (data) => {
    const { text } = data || {};
    const m = me();
    if (!m) return;
    const t = String(text || '').trim().slice(0, 200);
    if (!t) return;
    addChat(room, { name: m.name, color: myColor(), text: t });
  });
});

server.listen(PORT, () => {
  console.log(`오목 서버 실행 중: http://localhost:${PORT}`);
});
