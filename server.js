const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const Renju = require('./shared/renju');
const Quoridor = require('./shared/quoridor');

const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = 30 * 1000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const TOTAL_TIMES = [300, 600, 1200]; // 각자 주어지는 총 시간(초)
const CENTER = Math.floor(Renju.SIZE / 2);
const COLOR_NAME = { 1: '흑', 2: '백' };
const REASON_TEXT = {
  five: '5목 완성',
  goal: '목표 도달',
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
 *   code, game: 'omok' | 'quoridor', totalTime(초), status: 'waiting' | 'playing' | 'ended',
 *   seats: [seat|null, ...] (오목 2자리, 쿼리도 2~4자리), seat = { clientId, name, socketId, connected, graceTimer }
 *   turnTimer, turnStartedAt, rematch: Set<seatIdx>, members: Map<socketId, { clientId, name }>, chat: [], deleteTimer
 *
 *   오목: blackSeat: 0|1|null, board, moves: [[x,y]], turn: 1|2(색), winner: 1|2|0|null, reason,
 *         clocks: { 1: ms, 2: ms }, undoRequest: 1|2|null
 *   쿼리도: q(Quoridor 게임), names: [이름](대국 시작 때 스냅샷), firstSeat, turn: 자리 번호,
 *         winner: 자리 번호|null, clocks: [ms], history: [{q, turn}](무르기용),
 *         undoRequest: 자리 번호|null, undoAccepts: Set<자리 번호>
 * }
 * 시계(clocks)와 turn은 오목에서는 색, 쿼리도에서는 자리 번호를 키로 쓴다.
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

// 쿼리도: 아직 판에 말이 남아 있는 자리들 (차례 순서대로)
function aliveSeats(room) {
  return Quoridor.turnOrder(room.seats.length).filter((p) => room.q.pawns[p]);
}

function nextAlive(room, from) {
  const order = Quoridor.turnOrder(room.seats.length);
  const start = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    const p = order[(start + k) % order.length];
    if (room.q.pawns[p]) return p;
  }
  return from;
}

function stateFor(room, socketId) {
  const member = room.members.get(socketId);
  const mySeat = member ? seatIndexOf(room, member.clientId) : -1;
  const seatedIds = new Set(room.seats.filter(Boolean).map((s) => s.clientId));
  const common = {
    code: room.code,
    game: room.game,
    players: room.seats.length,
    totalTime: room.totalTime,
    status: room.status,
    turn: room.turn,
    winner: room.winner,
    reason: room.reason,
    spectators: [...room.members.values()].filter((m) => !seatedIds.has(m.clientId)).map((m) => m.name),
    undoRequest: room.undoRequest,
    rematch: [...room.rematch],
  };
  if (room.game === 'quoridor') {
    return {
      ...common,
      q: room.q,
      names: room.names,
      moveCount: room.history.length,
      clocks: room.clocks.map((_, i) => remainingOf(room, i)),
      seats: room.seats.map((s) => s && { name: s.name, connected: s.connected }),
      undoAccepts: [...room.undoAccepts],
      you: { seat: mySeat },
    };
  }
  return {
    ...common,
    board: room.board,
    moves: room.moves,
    clocks: { 1: remainingOf(room, Renju.BLACK), 2: remainingOf(room, Renju.WHITE) },
    seats: room.seats.map((s, i) => s && { name: s.name, connected: s.connected, color: seatColor(room, i) }),
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

// 체스 시계: 각자 총 시간을 갖고, 자기 차례에만 줄어든다 (key: 오목은 색, 쿼리도는 자리 번호)
function remainingOf(room, key) {
  let ms = room.clocks[key];
  if (room.turnStartedAt && key === room.turn) ms -= Date.now() - room.turnStartedAt;
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
    if (room.game === 'quoridor') forfeit(room, loser, 'timeout');
    else endGame(room, loser === Renju.BLACK ? Renju.WHITE : Renju.BLACK, 'timeout');
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
  room.status = 'playing';
  room.winner = null;
  room.reason = null;
  room.undoRequest = null;
  room.rematch.clear();
  if (room.game === 'quoridor') {
    const n = room.seats.length;
    room.q = Quoridor.createGame(n);
    room.names = room.seats.map((s) => s.name);
    room.history = [];
    room.undoAccepts.clear();
    room.turn = room.firstSeat;
    room.clocks = Array(n).fill(room.totalTime * 1000);
    startClock(room);
    const order = Quoridor.turnOrder(n);
    const from = order.indexOf(room.firstSeat);
    const names = order.map((_, k) => room.names[order[(from + k) % n]]);
    system(room, `새 대국 시작! 순서: ${names.join(' → ')}`);
    return;
  }
  room.board = Renju.createBoard();
  room.moves = [];
  room.turn = Renju.BLACK;
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
  if (room.game === 'quoridor') {
    room.undoAccepts.clear();
    system(room, `${room.names[winner]} 승리 — ${REASON_TEXT[reason]}`);
  } else if (winner) {
    const name = room.seats[seatOfColor(room, winner)]?.name ?? COLOR_NAME[winner];
    system(room, `${COLOR_NAME[winner]}(${name}) 승리 — ${REASON_TEXT[reason]}`);
  } else {
    system(room, `무승부 — ${REASON_TEXT[reason]}`);
  }
  broadcast(room);
  // 쿼리도에서 대국 중에 나간 사람이 있으면 빈 자리를 채우고 다음 대국을 기다린다
  if (!room.seats.every(Boolean)) {
    room.status = 'waiting';
    fillSeats(room);
    broadcast(room);
  }
}

// 대국자가 기권·퇴장·시간 초과·연결 끊김으로 빠질 때
// 오목은 상대가 이기고, 쿼리도는 그 말만 빼고 계속한다 (한 명만 남으면 그 사람이 승리)
function forfeit(room, idx, reason) {
  if (room.status !== 'playing' || idx < 0) return;
  if (room.game !== 'quoridor') {
    endGame(room, seatColor(room, idx) === Renju.BLACK ? Renju.WHITE : Renju.BLACK, reason);
    return;
  }
  if (!room.q.pawns[idx]) return;
  stopClock(room);
  room.q.pawns[idx] = null;
  room.history = []; // 탈락 이전으로는 무를 수 없음
  room.undoRequest = null;
  room.undoAccepts.clear();
  const alive = aliveSeats(room);
  if (alive.length === 1) return endGame(room, alive[0], reason);
  system(room, `${room.names[idx]} 님이 탈락했습니다 — ${REASON_TEXT[reason]}`);
  if (room.turn === idx) room.turn = nextAlive(room, idx);
  startClock(room);
  broadcast(room);
}

// 빈 자리에 관전자를 올리고, 모든 자리가 차면 대국 시작
function fillSeats(room) {
  if (room.status === 'playing') return;
  const seatedIds = () => new Set(room.seats.filter(Boolean).map((s) => s.clientId));
  for (let i = 0; i < room.seats.length; i++) {
    if (room.seats[i]) continue;
    const ids = seatedIds();
    const next = [...room.members.entries()].find(([, m]) => !ids.has(m.clientId));
    if (!next) break;
    const [socketId, m] = next;
    room.seats[i] = { clientId: m.clientId, name: m.name, socketId, connected: true, graceTimer: null };
    system(room, `${m.name} 님이 대국자로 참가했습니다`);
  }
  if (room.seats.every(Boolean) && room.status === 'waiting') {
    rotateFirst(room);
    newGame(room);
  }
}

// 선수 교대: 오목은 흑백을 바꾸고, 쿼리도는 첫 차례를 다음 자리로 넘긴다 (첫 판은 무작위)
function rotateFirst(room) {
  const n = room.seats.length;
  if (room.game === 'quoridor') {
    const order = Quoridor.turnOrder(n);
    room.firstSeat = room.firstSeat === null ? order[Math.floor(Math.random() * n)]
      : order[(order.indexOf(room.firstSeat) + 1) % n];
  } else {
    room.blackSeat = room.blackSeat === null ? Math.floor(Math.random() * 2) : 1 - room.blackSeat;
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

function createRoom(totalTime, game, players) {
  const isQ = game === 'quoridor';
  const n = isQ && [2, 3, 4].includes(players) ? players : 2;
  const room = {
    code: makeCode(),
    game: isQ ? 'quoridor' : 'omok',
    totalTime: TOTAL_TIMES.includes(totalTime) ? totalTime : 600,
    status: 'waiting',
    seats: Array(n).fill(null),
    winner: null,
    reason: null,
    turnStartedAt: null,
    turnTimer: null,
    undoRequest: null,
    rematch: new Set(),
    members: new Map(),
    chat: [],
    deleteTimer: null,
  };
  if (isQ) {
    Object.assign(room, {
      q: Quoridor.createGame(n),
      names: [],
      firstSeat: null,
      turn: null,
      clocks: Array(n).fill(0),
      history: [],
      undoAccepts: new Set(),
    });
  } else {
    Object.assign(room, {
      blackSeat: null,
      board: Renju.createBoard(),
      moves: [],
      turn: Renju.BLACK,
      clocks: { 1: 0, 2: 0 },
    });
  }
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
        forfeit(r, idx, 'leave');
        system(r, `${member.name} 님이 나갔습니다`);
        freeSeat(r, idx);
      } else {
        seat.connected = false;
        system(r, `${member.name} 님의 연결이 끊겼습니다 (30초 안에 돌아오지 않으면 자리를 잃습니다)`);
        seat.graceTimer = setTimeout(() => {
          const i = r.seats.indexOf(seat);
          if (i < 0 || seat.connected) return;
          forfeit(r, i, 'disconnect');
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
    return { ok: true, code: r.code, game: r.game };
  }

  // 주의: 클라이언트가 null 등을 보내도 서버가 죽지 않도록 `data || {}`로 꺼낸다
  socket.on('createRoom', (data, cb) => {
    const { name, clientId, totalTime, game, players } = data || {};
    if (typeof cb !== 'function' || !clientId) return;
    const r = createRoom(Number(totalTime), game, Number(players));
    cb(join(r.code, cleanName(name), String(clientId)));
  });

  socket.on('joinRoom', (data, cb) => {
    const { code, name, clientId } = data || {};
    if (typeof cb !== 'function' || !clientId) return;
    cb(join(code, cleanName(name), String(clientId)));
  });

  socket.on('leaveRoom', () => leaveCurrent(true));
  socket.on('disconnect', () => leaveCurrent(false));

  // 오목 착수
  socket.on('place', (data) => {
    const { x, y } = data || {};
    if (!room || room.game !== 'omok' || room.status !== 'playing') return;
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

  // 쿼리도: 말 이동 {type:'pawn', x, y} 또는 벽 설치 {type:'wall', x, y, o}
  socket.on('move', (data) => {
    const { type, x, y, o } = data || {};
    if (!room || room.game !== 'quoridor' || room.status !== 'playing') return;
    const idx = mySeatIdx();
    const q = room.q;
    if (idx < 0) return fail('관전자는 둘 수 없습니다.');
    if (!q.pawns[idx]) return fail('탈락해서 더 둘 수 없습니다.');
    if (idx !== room.turn) return fail('내 차례가 아닙니다.');
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (type === 'pawn') {
      if (!Quoridor.legalMoves(q, idx).some((m) => m.x === x && m.y === y)) return fail('그 칸으로는 갈 수 없습니다.');
    } else if (type === 'wall') {
      if (q.wallsLeft[idx] <= 0) return fail('남은 벽이 없습니다.');
      const err = Quoridor.wallError(q, x, y, o);
      if (err) return fail(err);
    } else {
      return;
    }

    stopClock(room);
    room.history.push({ q: structuredClone(q), turn: room.turn });
    if (type === 'pawn') Quoridor.applyMove(q, idx, x, y);
    else Quoridor.applyWall(q, idx, x, y, o);
    room.undoRequest = null;
    room.undoAccepts.clear();
    io.to(room.code).emit('stonePlaced');

    if (type === 'pawn' && Quoridor.isGoal(idx, x, y)) return endGame(room, idx, 'goal');
    room.turn = nextAlive(room, idx);
    startClock(room);
    broadcast(room);
  });

  socket.on('undoRequest', () => {
    if (!room || room.status !== 'playing') return;
    if (room.game === 'quoridor') {
      const idx = mySeatIdx();
      if (idx < 0 || !room.q.pawns[idx]) return;
      if (room.undoRequest !== null) return fail('이미 무르기 요청이 진행 중입니다.');
      const last = room.q.last;
      if (!room.history.length || !last || last.p !== idx) return fail('방금 둔 수만 무를 수 있습니다.');
      room.undoRequest = idx;
      room.undoAccepts.clear();
      system(room, `${me().name} 님이 무르기를 요청했습니다`);
      return broadcast(room);
    }
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
    if (!room || room.status !== 'playing') return;
    if (room.game === 'quoridor') {
      const idx = mySeatIdx();
      const requester = room.undoRequest;
      if (requester === null || idx < 0 || idx === requester || !room.q.pawns[idx]) return;
      if (!accept) {
        room.undoRequest = null;
        room.undoAccepts.clear();
        system(room, `${me().name} 님이 무르기를 거절했습니다`);
        return broadcast(room);
      }
      room.undoAccepts.add(idx);
      // 나머지 대국자 전원이 수락하면 직전 1수를 되돌림
      if (aliveSeats(room).every((p) => p === requester || room.undoAccepts.has(p))) {
        stopClock(room);
        room.q = room.history.pop().q;
        room.turn = requester;
        room.undoRequest = null;
        room.undoAccepts.clear();
        startClock(room);
        system(room, '무르기가 수락되어 1수를 되돌렸습니다');
      }
      return broadcast(room);
    }
    if (!room.undoRequest) return;
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
    forfeit(room, mySeatIdx(), 'resign');
  });

  socket.on('rematch', () => {
    if (!room || room.status !== 'ended') return;
    const idx = mySeatIdx();
    if (idx < 0) return;
    room.rematch.add(idx);
    if (room.seats.every(Boolean) && room.rematch.size === room.seats.length) {
      rotateFirst(room);
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
    const seat = mySeatIdx();
    addChat(room, room.game === 'quoridor' ? { name: m.name, seat, text: t } : { name: m.name, color: myColor(), text: t });
  });
});

server.listen(PORT, () => {
  console.log(`보드게임 서버 실행 중: http://localhost:${PORT}`);
});
