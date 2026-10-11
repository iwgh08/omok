const test = require('node:test');
const assert = require('node:assert');
const Renju = require('../shared/renju');

function board(black = [], white = []) {
  const b = Renju.createBoard();
  for (const [x, y] of black) b[y * Renju.SIZE + x] = Renju.BLACK;
  for (const [x, y] of white) b[y * Renju.SIZE + x] = Renju.WHITE;
  return b;
}

test('3-3 금수', () => {
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), '33');
});

test('띈 삼을 포함한 3-3 금수', () => {
  const b = board([[4, 7], [6, 7], [7, 5], [7, 6]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), '33');
});

test('한쪽이 막힌 삼은 3-3이 아님', () => {
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6]], [[4, 7]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), null);
});

test('4-4 금수', () => {
  const b = board([[4, 7], [5, 7], [6, 7], [7, 4], [7, 5], [7, 6]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), '44');
});

test('한 줄 4-4 (X_XXX_X) 금수', () => {
  const b = board([[3, 7], [5, 7], [7, 7], [9, 7]]);
  assert.strictEqual(Renju.forbiddenType(b, 6, 7), '44');
});

test('4-3은 허용', () => {
  const b = board([[4, 7], [5, 7], [6, 7], [7, 5], [7, 6]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), null);
});

test('장목 금수', () => {
  const b = board([[2, 7], [3, 7], [4, 7], [6, 7], [7, 7]]);
  assert.strictEqual(Renju.forbiddenType(b, 5, 7), 'overline');
});

test('정확한 5목은 3-3이 함께 생겨도 승리', () => {
  const b = board([[3, 7], [4, 7], [5, 7], [6, 7], [7, 5], [7, 6], [8, 6], [9, 5]]);
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), null);
  b[7 * 15 + 7] = Renju.BLACK;
  assert.ok(Renju.isWin(b, 7, 7, Renju.BLACK));
});

test('거짓 3-3: 완성점이 금수인 삼은 삼이 아님', () => {
  // 가로 삼(5,6,7)은 왼쪽이 막혀 (8,7)로만 열린 4가 되는데, (8,7)은 4-4 금수
  const b = board([[5, 7], [6, 7], [7, 5], [7, 6], [8, 4], [8, 5], [8, 6]], [[3, 7]]);
  const after = b.slice();
  after[7 * 15 + 7] = Renju.BLACK;
  assert.strictEqual(Renju.forbiddenType(after, 8, 7), '44');
  assert.strictEqual(Renju.forbiddenType(b, 7, 7), null);
});

test('흑 장목은 승리 아님, 백 장목은 승리', () => {
  const pts = [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7]];
  assert.ok(!Renju.isWin(board(pts), 7, 7, Renju.BLACK));
  assert.ok(Renju.isWin(board([], pts), 7, 7, Renju.WHITE));
});

test('빈 판 전체 금수 계산이 충분히 빠름', () => {
  const b = board([[7, 7], [6, 6], [8, 8], [6, 8], [8, 6], [5, 7], [9, 7]]);
  const t = Date.now();
  Renju.allForbidden(b);
  assert.ok(Date.now() - t < 500);
});
