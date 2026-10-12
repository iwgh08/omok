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
const sockets = [];

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('실행 중') && resolve());
    server.on('exit', (code) => reject(new Error(`서버가 종료됨 (code ${code})`)));
    setTimeout(() => reject(new Error('서버 시작 시간 초과')), 5000);
  });
});

test.after(() => {
  sockets.forEach((s) => s.disconnect());
  server.kill();
});

function client(name, clientId) {
  const s = io(URL, { forceNew: true });
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
    assert.deepStrictEqual(A.state.clocks, { 1: 300000, 2: 300000 }, '새 대국은 시계 초기화');
    await sleep(1000);
    await place(black, 7, 7);
    const b1 = A.state.clocks[1];
    assert.ok(b1 < 299200 && b1 > 298000, `흑 시계만 감소 (${b1})`);
    assert.strictEqual(A.state.clocks[2], 300000);
    await sleep(700);
    await place(white, 0, 0);
    assert.strictEqual(A.state.clocks[1], b1, '상대 차례엔 내 시계 정지');
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
