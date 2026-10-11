// 렌주룰 판정 로직 (서버/브라우저 공용)
// 보드: 길이 SIZE*SIZE 배열, 0 = 빈칸, 1 = 흑, 2 = 백
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Renju = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 15;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const MAX_DEPTH = 6; // 거짓 3-3 재귀 검사 깊이 제한

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  }
  function get(b, x, y) {
    return inside(x, y) ? b[y * SIZE + x] : -1;
  }
  function set(b, x, y, v) {
    b[y * SIZE + x] = v;
  }

  // (x,y)를 지나는 color 돌의 연속 개수 (x,y) 포함
  function runLength(b, x, y, dx, dy, color) {
    let n = 1;
    let i = x + dx, j = y + dy;
    while (get(b, i, j) === color) { n++; i += dx; j += dy; }
    i = x - dx; j = y - dy;
    while (get(b, i, j) === color) { n++; i -= dx; j -= dy; }
    return n;
  }

  function isFiveRun(n, color) {
    return color === BLACK ? n === 5 : n >= 5;
  }

  // (x,y)에 돌이 놓여 있다고 가정할 때, 이 방향에서 한 수 더 두면
  // (x,y)를 포함하는 5목이 되는 빈 자리들의 오프셋 목록
  function fivePoints(b, x, y, dx, dy, color) {
    const pts = [];
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const px = x + k * dx, py = y + k * dy;
      if (get(b, px, py) !== EMPTY) continue;
      // p와 (x,y) 사이가 모두 같은 색이어야 같은 줄의 5목
      const s = Math.sign(k);
      let connected = true;
      for (let t = s; t !== k; t += s) {
        if (get(b, x + t * dx, y + t * dy) !== color) { connected = false; break; }
      }
      if (!connected) continue;
      set(b, px, py, color);
      if (isFiveRun(runLength(b, px, py, dx, dy, color), color)) pts.push(k);
      set(b, px, py, EMPTY);
    }
    return pts;
  }

  // 이 방향의 4 개수 (열린 4는 1개, 띈 4-4 같은 한 줄 두 개의 4는 2개)
  function fourCount(b, x, y, dx, dy, color) {
    const pts = fivePoints(b, x, y, dx, dy, color);
    if (pts.length === 0) return 0;
    if (pts.length === 2 && Math.abs(pts[0] - pts[1]) === 5) return 1;
    return Math.min(pts.length, 2);
  }

  function isOpenFour(b, x, y, dx, dy, color) {
    const pts = fivePoints(b, x, y, dx, dy, color);
    return pts.length === 2 && Math.abs(pts[0] - pts[1]) === 5;
  }

  // (x,y)에 흑이 놓인 상태에서 이 방향이 '삼'인지:
  // 한 수 더 두어 열린 4가 되고, 그 한 수가 금수가 아니어야 함
  function isThree(b, x, y, dx, dy, depth) {
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const px = x + k * dx, py = y + k * dy;
      if (get(b, px, py) !== EMPTY) continue;
      set(b, px, py, BLACK);
      const open = isOpenFour(b, x, y, dx, dy, BLACK);
      set(b, px, py, EMPTY);
      if (open && !forbiddenType(b, px, py, depth + 1)) return true;
    }
    return false;
  }

  // 흑이 (x,y)에 둘 때 금수면 '33' | '44' | 'overline', 아니면 null
  function forbiddenType(b, x, y, depth) {
    depth = depth || 0;
    if (get(b, x, y) !== EMPTY) return null;
    set(b, x, y, BLACK);
    let result = null;
    try {
      const runs = DIRS.map(([dx, dy]) => runLength(b, x, y, dx, dy, BLACK));
      if (runs.some((n) => n === 5)) return null; // 정확한 5목은 금수보다 우선
      if (runs.some((n) => n >= 6)) return (result = 'overline');

      let fours = 0;
      for (const [dx, dy] of DIRS) fours += fourCount(b, x, y, dx, dy, BLACK);
      if (fours >= 2) return (result = '44');

      if (depth < MAX_DEPTH) {
        let threes = 0;
        for (const [dx, dy] of DIRS) {
          if (fourCount(b, x, y, dx, dy, BLACK) > 0) continue; // 4가 된 줄은 삼이 아님
          if (isThree(b, x, y, dx, dy, depth)) threes++;
          if (threes >= 2) return (result = '33');
        }
      }
      return result;
    } finally {
      set(b, x, y, EMPTY);
    }
  }

  // 이미 (x,y)에 color 돌이 놓인 뒤 승리했는지
  function isWin(b, x, y, color) {
    return DIRS.some(([dx, dy]) => isFiveRun(runLength(b, x, y, dx, dy, color), color));
  }

  // 흑 차례에 둘 수 없는 모든 자리 [{x, y, type}]
  function allForbidden(b) {
    const out = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (b[y * SIZE + x] !== EMPTY) continue;
        const type = forbiddenType(b, x, y);
        if (type) out.push({ x, y, type });
      }
    }
    return out;
  }

  const FORBIDDEN_NAMES = { '33': '3-3 금수', '44': '4-4 금수', overline: '장목(6목 이상) 금수' };

  return {
    SIZE, EMPTY, BLACK, WHITE,
    forbiddenType, isWin, allForbidden, FORBIDDEN_NAMES,
    createBoard: () => new Array(SIZE * SIZE).fill(EMPTY),
  };
});
