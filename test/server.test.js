// 서버 통합 테스트: 실제 서버를 띄우고 소켓 클라이언트 여러 개로 대국 흐름을 확인한다
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
const servers = [];
const sockets = [];

async function startServer(port, env = {}) {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(proc);
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => String(d).includes('실행 중') && resolve());
    proc.on('exit', (code) => reject(new Error(`서버가 종료됨 (code ${code})`)));
    setTimeout(() => reject(new Error('서버 시작 시간 초과')), 5000);
  });
  return proc;
}

test.before(async () => {
  server = await startServer(PORT);
});

test.after(() => {
  sockets.forEach((s) => s.disconnect());
  servers.forEach((s) => s.kill());
});

function client(name, clientId, url = URL) {
  const s = io(url, { forceNew: true });
  sockets.push(s);
  const c = { s, name, clientId, state: null, errors: [], chat: [] };
  s.on('state', (st) => (c.state = st));
  s.on('errorMsg', (m) => c.errors.push(m));
  s.on('chat', (m) => c.chat.push(m));
  return c;
}
const emit = (c, ev, data) => new Promise((r) => c.s.emit(ev, data, r));
const place = async (c, x, y) => { c.s.emit('place', { x, y }); await sleep(80); };

test('대국 전체 흐름', async (t) => {
  const A = client('철수', 'id-a');
  const B = client('영희', 'id-b');
  const C = client('관전자', 'id-c');
  await sleep(200);

  const res = await emit(A, 'createRoom', { name: A.name, clientId: A.clientId, totalTime: 300 });
  assert.ok(res.ok && res.code.length === 6, '방 생성');
  await sleep(100);
  assert.strictEqual(A.state.status, 'waiting', '혼자일 때 대기');

  await emit(B, 'joinRoom', { code: res.code.toLowerCase(), name: B.name, clientId: B.clientId });
  await emit(C, 'joinRoom', { code: res.code, name: C.name, clientId: C.clientId });
  await sleep(200);
  assert.strictEqual(A.state.status, 'playing', '두 명이면 대국 시작');
  assert.ok(C.state.you.seat === -1 && C.state.spectators.includes('관전자'), '세 번째는 관전자');

  const byColor = () => (A.state.you.color === 1 ? [A, B] : [B, A]);
  let [black, white] = byColor();

  await t.test('착수 검증', async () => {
    await place(black, 3, 3);
    assert.ok(black.errors.some((e) => e.includes('정중앙')), '첫 수는 중앙');
    await place(white, 7, 7);
    assert.ok(white.errors.includes('상대 차례입니다.'), '차례 검증');
    await place(C, 7, 7);
    assert.ok(C.errors.some((e) => e.includes('관전자')), '관전자 착수 불가');
  });

  await t.test('무르기', async () => {
    await place(black, 7, 7); await place(white, 0, 0);
    await place(black, 8, 7); await place(white, 0, 2);
    white.s.emit('undoRequest'); await sleep(80);
    assert.strictEqual(black.state.undoRequest, 2, '요청 전달');
    black.s.emit('undoReply', { accept: true }); await sleep(80);
    assert.strictEqual(A.state.moves.length, 3, '상대 차례 요청이면 1수 취소');
    assert.strictEqual(A.state.turn, 2);
  });

  await t.test('3-3 금수 거부', async () => {
    await place(white, 0, 2);
    await place(black, 9, 6); await place(white, 0, 4);
    await place(black, 9, 5); await place(white, 0, 6);
    await place(black, 9, 7);
    assert.ok(black.errors.some((e) => e.includes('3-3')));
  });

  await t.test('잘못된 데이터를 보내도 서버가 살아 있음', async () => {
    for (const ev of ['place', 'chat', 'undoReply', 'createRoom', 'joinRoom']) C.s.emit(ev, null);
    await sleep(200);
    assert.strictEqual(server.exitCode, null);
    black.s.emit('chat', { text: '안녕!' }); await sleep(100);
    assert.ok(C.chat.some((m) => m.text === '안녕!'), '채팅이 관전자에게도 전달');
  });

  await t.test('기권과 재대국(흑백 교대)', async () => {
    black.s.emit('resign'); await sleep(100);
    assert.strictEqual(A.state.status, 'ended');
    assert.strictEqual(A.state.winner, 2);
    const oldBlackSeat = black.state.you.seat;
    A.s.emit('rematch'); B.s.emit('rematch'); await sleep(150);
    assert.strictEqual(A.state.status, 'playing');
    [black, white] = byColor();
    assert.notStrictEqual(black.state.you.seat, oldBlackSeat);
  });

  await t.test('체스 시계', async () => {
    // 흑 시계는 startClock과 broadcast 사이에 몇 ms가 흐를 수 있음
    assert.ok(A.state.clocks[1] > 299900 && A.state.clocks[2] === 300000, '새 대국은 시계 초기화');
    await sleep(1000);
    await place(black, 7, 7);
    const b1 = A.state.clocks[1];
    assert.ok(b1 < 299200 && b1 > 298000, `흑 시계만 감소 (${b1})`);
    // 백 시계는 방금 시작됨 (startClock과 broadcast 사이에 몇 ms가 흐를 수 있음)
    assert.ok(A.state.clocks[2] > 299900, `백 시계는 거의 그대로 (${A.state.clocks[2]})`);
    await sleep(700);
    await place(white, 0, 0);
    // 백이 두자마자 흑 시계가 다시 돌기 시작하므로 몇 ms 차이는 허용
    assert.ok(b1 - A.state.clocks[1] < 50, `상대 차례엔 내 시계 정지 (${b1} → ${A.state.clocks[1]})`);
    assert.ok(A.state.clocks[2] < 299500);
  });

  await t.test('5목 승리', async () => {
    for (let i = 1; i < 4; i++) { await place(black, 7 + i, 7); await place(white, 0, i * 2); }
    await place(black, 11, 7);
    assert.strictEqual(A.state.status, 'ended');
    assert.strictEqual(A.state.winner, 1);
    assert.strictEqual(A.state.reason, 'five');
  });

  await t.test('연결 끊김 후 재접속하면 자리 복귀', async () => {
    white.s.disconnect(); await sleep(150);
    assert.ok(black.state.seats.some((s) => s && !s.connected));
    const again = client(white.name, white.clientId); await sleep(200);
    await emit(again, 'joinRoom', { code: res.code, name: white.name, clientId: white.clientId });
    await sleep(150);
    assert.ok(again.state.you.seat >= 0 && again.state.seats.every((s) => s.connected));
  });
});

test('쿼리도 3인 흐름', async (t) => {
  const Q = require('../shared/quoridor');
  const P = [client('가', 'q-a'), client('나', 'q-b'), client('다', 'q-c')];
  const S = client('구경꾼', 'q-d');
  await sleep(200);

  const res = await emit(P[0], 'createRoom', { name: '가', clientId: 'q-a', totalTime: 300, game: 'quoridor', players: 3 });
  assert.ok(res.ok && res.game === 'quoridor');
  await emit(P[1], 'joinRoom', { code: res.code, name: '나', clientId: 'q-b' });
  await sleep(100);
  assert.strictEqual(P[0].state.status, 'waiting', '2명이면 아직 대기');
  await emit(P[2], 'joinRoom', { code: res.code, name: '다', clientId: 'q-c' });
  await emit(S, 'joinRoom', { code: res.code, name: '구경꾼', clientId: 'q-d' });
  await sleep(200);
  assert.strictEqual(P[0].state.status, 'playing', '3명이 차면 시작');
  assert.strictEqual(S.state.you.seat, -1, '4번째는 관전자');
  assert.deepStrictEqual(P[0].state.q.wallsLeft, [7, 7, 7]);

  const bySeat = () => { const m = []; P.forEach((c) => (m[c.state.you.seat] = c)); return m; };
  const st = () => P[0].state;
  const move = async (c, data) => { c.s.emit('move', data); await sleep(80); };

  await t.test('차례 검증과 벽 설치', async () => {
    const first = st().turn;
    const other = bySeat()[Q.turnOrder(3).find((p) => p !== first)];
    await move(other, { type: 'wall', x: 0, y: 3, o: 'h' });
    assert.ok(other.errors.includes('내 차례가 아닙니다.'));
    await move(S, { type: 'wall', x: 0, y: 3, o: 'h' });
    assert.ok(S.errors.some((e) => e.includes('관전자')));
    await move(bySeat()[first], { type: 'wall', x: 0, y: 3, o: 'h' });
    assert.strictEqual(st().q.walls.length, 1);
    assert.strictEqual(st().q.wallsLeft[first], 6);
    assert.notStrictEqual(st().turn, first);
  });

  await t.test('무르기는 나머지 전원이 수락해야 함', async () => {
    const requester = st().q.last.p;
    const others = Q.turnOrder(3).filter((p) => p !== requester);
    bySeat()[requester].s.emit('undoRequest'); await sleep(80);
    assert.strictEqual(st().undoRequest, requester);
    bySeat()[others[0]].s.emit('undoReply', { accept: true }); await sleep(80);
    assert.strictEqual(st().q.walls.length, 1, '한 명만 수락하면 대기');
    bySeat()[others[1]].s.emit('undoReply', { accept: true }); await sleep(80);
    assert.strictEqual(st().q.walls.length, 0, '전원 수락하면 되돌림');
    assert.strictEqual(st().turn, requester);
    assert.strictEqual(st().q.wallsLeft[requester], 7);
  });

  await t.test('말 이동', async () => {
    const p = st().turn;
    const [m] = Q.legalMoves(st().q, p);
    await move(bySeat()[p], { type: 'pawn', x: m.x, y: m.y });
    assert.deepStrictEqual(st().q.pawns[p], m);
    await move(bySeat()[st().turn], { type: 'pawn', x: 99, y: 0 });
    assert.ok(bySeat()[st().turn].errors.includes('그 칸으로는 갈 수 없습니다.'));
  });

  await t.test('기권하면 탈락하고 나머지끼리 계속, 한 명 남으면 승리', async () => {
    const cur = st().turn;
    const map = bySeat();
    map[cur].s.emit('resign'); await sleep(100);
    assert.strictEqual(st().status, 'playing');
    assert.strictEqual(st().q.pawns[cur], null);
    assert.notStrictEqual(st().turn, cur, '탈락자 차례면 다음 사람으로');
    const loser2 = st().turn;
    map[loser2].s.emit('resign'); await sleep(100);
    assert.strictEqual(st().status, 'ended');
    const winner = Q.turnOrder(3).find((p) => p !== cur && p !== loser2);
    assert.strictEqual(st().winner, winner);
  });

  await t.test('재대국은 전원 동의', async () => {
    P[0].s.emit('rematch'); P[1].s.emit('rematch'); await sleep(100);
    assert.strictEqual(st().status, 'ended');
    P[2].s.emit('rematch'); await sleep(150);
    assert.strictEqual(st().status, 'playing');
    assert.ok(st().q.pawns.every(Boolean));
  });

  await t.test('대국 중 퇴장해도 나머지끼리 계속', async () => {
    const leaver = bySeat()[st().turn];
    const seat = leaver.state.you.seat;
    leaver.s.emit('leaveRoom'); await sleep(150);
    assert.strictEqual(S.state.status, 'playing');
    assert.strictEqual(S.state.q.pawns[seat], null);
    assert.strictEqual(S.state.seats[seat], null);
  });
});

test('부루마블 2인 흐름', async (t) => {
  const P = [client('갑', 'm-a'), client('을', 'm-b')];
  const S = client('구경', 'm-c');
  await sleep(200);

  const res = await emit(P[0], 'createRoom', { name: '갑', clientId: 'm-a', game: 'marble', players: 2, rounds: 15 });
  assert.ok(res.ok && res.game === 'marble');
  await emit(P[1], 'joinRoom', { code: res.code, name: '을', clientId: 'm-b' });
  await emit(S, 'joinRoom', { code: res.code, name: '구경', clientId: 'm-c' });
  await sleep(200);

  const st = () => P[0].state;
  const bySeat = () => { const m = []; P.forEach((c) => (m[c.state.you.seat] = c)); return m; };
  const act = async (c, data) => { c.s.emit('act', data); await sleep(80); };

  await t.test('2명이 차면 시작, 카드 순서는 숨김', () => {
    assert.strictEqual(st().status, 'playing');
    assert.strictEqual(st().rounds, 15);
    assert.strictEqual(st().totalTime, 30, '결정 1번당 30초');
    assert.strictEqual(st().m.deck, undefined);
    assert.strictEqual(st().turn, st().m.turn);
    assert.strictEqual(S.state.you.seat, -1);
  });

  await t.test('차례·관전자·무르기 검증', async () => {
    const other = bySeat()[1 - st().turn];
    await act(other, { type: 'roll' });
    assert.ok(other.errors.includes('내 차례가 아닙니다.'));
    await act(S, { type: 'roll' });
    assert.ok(S.errors.some((e) => e.includes('관전자')));
    other.s.emit('undoRequest'); await sleep(80);
    assert.ok(other.errors.some((e) => e.includes('무르기')));
    for (const ev of ['act', 'undoReply']) S.s.emit(ev, null);
    const cur = bySeat()[st().turn];
    for (const type of ['__proto__', 'constructor', 'toString']) cur.s.emit('act', { type });
    cur.s.emit('act', { type: 'build', villa: { a: 1 } });
    await sleep(100);
    assert.strictEqual(server.exitCode, null, '이상한 행동을 보내도 서버가 살아 있음');
  });

  await t.test('주사위를 굴리면 진행', async () => {
    const seq = st().m.seq;
    await act(bySeat()[st().turn], { type: 'roll' });
    assert.ok(st().m.seq > seq);
    assert.strictEqual(st().m.dice.length, 2);
  });

  await t.test('기권하면 상대 승리', async () => {
    const loser = bySeat()[st().turn].state.you.seat;
    bySeat()[loser].s.emit('resign'); await sleep(100);
    assert.strictEqual(st().status, 'ended');
    assert.strictEqual(st().winner, 1 - loser);
    assert.strictEqual(st().reason, 'resign');
  });
});

test('부루마블 시간 초과는 자동 진행', async () => {
  const port = PORT + 100;
  await startServer(port, { MARBLE_TURN_SEC: '0.4' });
  const url = `http://localhost:${port}`;
  const A = client('갑', 't-a', url);
  const B = client('을', 't-b', url);
  await sleep(200);
  const res = await emit(A, 'createRoom', { name: '갑', clientId: 't-a', game: 'marble', players: 2 });
  await emit(B, 'joinRoom', { code: res.code, name: '을', clientId: 't-b' });
  await sleep(150);
  assert.strictEqual(A.state.status, 'playing');
  const seq = A.state.m.seq;
  await sleep(1500);
  assert.ok(A.state.m.seq > seq, '가만히 있어도 진행됨');
  assert.ok(A.state.m.log.some((l) => l.includes('자동 진행')));
  assert.ok(A.state.m.players.every((p) => !p.out), '시간 초과로는 탈락하지 않음');
});
