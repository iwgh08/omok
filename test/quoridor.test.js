const test = require('node:test');
const assert = require('node:assert');
const Q = require('../shared/quoridor');

const sorted = (list) => list.map((m) => `${m.x},${m.y}`).sort();

test('시작 위치와 벽 개수', () => {
  const g2 = Q.createGame(2);
  assert.deepStrictEqual(g2.pawns, [{ x: 4, y: 8 }, { x: 4, y: 0 }]);
  assert.deepStrictEqual(g2.wallsLeft, [10, 10]);
  assert.deepStrictEqual(Q.createGame(3).wallsLeft, [7, 7, 7]);
  assert.deepStrictEqual(Q.createGame(4).wallsLeft, [5, 5, 5, 5]);
  assert.deepStrictEqual(Q.turnOrder(3), [0, 2, 1]);
});

test('기본 이동: 판 끝은 갈 수 없음', () => {
  const g = Q.createGame(2);
  assert.deepStrictEqual(sorted(Q.legalMoves(g, 0)), ['3,8', '4,7', '5,8']);
});

test('벽에 막히면 그쪽으로 못 감', () => {
  const g = Q.createGame(2);
  Q.applyWall(g, 1, 3, 7, 'h'); // 7행과 8행 사이, 3·4열
  assert.deepStrictEqual(sorted(Q.legalMoves(g, 0)), ['3,8', '5,8']);
  Q.applyWall(g, 1, 4, 7, 'v'); // 4열과 5열 사이, 7·8행
  assert.deepStrictEqual(sorted(Q.legalMoves(g, 0)), ['3,8']);
});

test('뛰어넘기', () => {
  const g = Q.createGame(2);
  g.pawns[0] = { x: 4, y: 5 };
  g.pawns[1] = { x: 4, y: 4 };
  assert.ok(sorted(Q.legalMoves(g, 0)).includes('4,3'));
  assert.ok(!sorted(Q.legalMoves(g, 0)).includes('4,4'));
});

test('뒤가 벽이면 대각선', () => {
  const g = Q.createGame(2);
  g.pawns[0] = { x: 4, y: 5 };
  g.pawns[1] = { x: 4, y: 4 };
  Q.applyWall(g, 1, 4, 3, 'h'); // 상대 말 뒤를 막음
  assert.deepStrictEqual(sorted(Q.legalMoves(g, 0)), ['3,4', '3,5', '4,6', '5,4', '5,5']);
});

test('뒤가 판 끝이면 대각선', () => {
  const g = Q.createGame(2);
  g.pawns[0] = { x: 4, y: 1 };
  assert.deepStrictEqual(sorted(Q.legalMoves(g, 0)), ['3,0', '3,1', '4,2', '5,0', '5,1']);
});

test('뒤가 다른 말이면 대각선 (4인)', () => {
  const g = Q.createGame(4);
  g.pawns[0] = { x: 4, y: 6 };
  g.pawns[1] = { x: 4, y: 5 };
  g.pawns[2] = { x: 4, y: 4 };
  const moves = sorted(Q.legalMoves(g, 0));
  assert.ok(moves.includes('3,5') && moves.includes('5,5'));
  assert.ok(!moves.includes('4,4') && !moves.includes('4,3'));
});

test('벽 겹침·교차·판 밖 거부', () => {
  const g = Q.createGame(2);
  Q.applyWall(g, 0, 3, 3, 'h');
  assert.match(Q.wallError(g, 3, 3, 'h'), /겹/);
  assert.match(Q.wallError(g, 4, 3, 'h'), /겹/);
  assert.match(Q.wallError(g, 2, 3, 'h'), /겹/);
  assert.match(Q.wallError(g, 3, 3, 'v'), /교차/);
  assert.strictEqual(Q.wallError(g, 5, 3, 'h'), null);
  assert.strictEqual(Q.wallError(g, 3, 2, 'v'), null);
  assert.ok(Q.wallError(g, 8, 0, 'h'));
  assert.ok(Q.wallError(g, 0, 0, 'x'));
});

test('길을 완전히 막는 벽은 거부', () => {
  const g = Q.createGame(2);
  // 0행과 1행 사이를 0~7열까지 막음 → 1번 말(4,0)이 내려갈 틈은 8열 하나
  for (const x of [0, 2, 4, 6]) Q.applyWall(g, 0, x, 0, 'h');
  // 7·8열 사이를 막으면 1번 말이 갇힘
  assert.match(Q.wallError(g, 7, 0, 'v'), /길/);
  assert.strictEqual(Q.wallError(g, 7, 1, 'v'), null);
});

test('탈락한 말은 경로 검사에서 빠짐', () => {
  const g = Q.createGame(2);
  // 1번 말을 왼쪽 위 구석에 가두는 벽: 탈락 전엔 거부
  g.pawns[1] = { x: 0, y: 0 };
  Q.applyWall(g, 1, 0, 0, 'v'); // 0·1열 사이, 0·1행
  assert.match(Q.wallError(g, 0, 1, 'h'), /길/);
  g.pawns[1] = null;
  assert.strictEqual(Q.wallError(g, 0, 1, 'h'), null);
});

test('목표 판정', () => {
  assert.ok(Q.isGoal(0, 3, 0) && !Q.isGoal(0, 3, 1));
  assert.ok(Q.isGoal(1, 0, 8));
  assert.ok(Q.isGoal(2, 8, 2));
  assert.ok(Q.isGoal(3, 0, 6));
});
