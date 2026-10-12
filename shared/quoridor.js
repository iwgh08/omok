// 쿼리도 규칙 판정 로직 (서버/브라우저 공용)
// 판: SIZE×SIZE 칸. 말 = {x, y}, 탈락한 말은 null
// 벽 = {x, y, o, p}: (x, y)는 0~SIZE-2 홈 교차점, o는 'h'(가로) | 'v'(세로), p는 설치한 자리
//   가로벽 (x, y, 'h'): y행과 y+1행 사이, x열·x+1열을 막음
//   세로벽 (x, y, 'v'): x열과 x+1열 사이, y행·y+1행을 막음
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Quoridor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 9;
  const MID = Math.floor(SIZE / 2);
  const WALLS = { 2: 10, 3: 7, 4: 5 }; // 인원별 1인당 벽 개수
  // 자리별 시작 위치: 0 아래, 1 위, 2 왼쪽, 3 오른쪽 (목표는 반대편 끝 줄)
  const START = [[MID, SIZE - 1], [MID, 0], [0, MID], [SIZE - 1, MID]];
  // 차례 순서: 판을 시계 방향으로 돈다 (아래 → 왼쪽 → 위 → 오른쪽)
  const ORDER = [0, 2, 1, 3];
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function createGame(n) {
    return {
      n,
      pawns: START.slice(0, n).map(([x, y]) => ({ x, y })),
      walls: [],
      wallsLeft: Array(n).fill(WALLS[n]),
      last: null, // 마지막 수: {p, type: 'pawn'|'wall', x, y, o?}
    };
  }

  function turnOrder(n) {
    return ORDER.filter((p) => p < n);
  }

  function isGoal(p, x, y) {
    if (p === 0) return y === 0;
    if (p === 1) return y === SIZE - 1;
    if (p === 2) return x === SIZE - 1;
    return x === 0;
  }

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  }

  function hasWall(walls, x, y, o) {
    return walls.some((w) => w.x === x && w.y === y && w.o === o);
  }

  // (x, y)에서 (dx, dy)로 한 칸 가는 길이 판 끝이나 벽으로 막혔는지
  function blocked(walls, x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!inside(nx, ny)) return true;
    if (dy !== 0) {
      const gy = Math.min(y, ny); // 가로벽의 행
      return hasWall(walls, x, gy, 'h') || hasWall(walls, x - 1, gy, 'h');
    }
    const gx = Math.min(x, nx); // 세로벽의 열
    return hasWall(walls, gx, y, 'v') || hasWall(walls, gx, y - 1, 'v');
  }

  function pawnAt(g, x, y) {
    return g.pawns.findIndex((q) => q && q.x === x && q.y === y);
  }

  // p번 말이 갈 수 있는 칸 목록 [{x, y}]
  function legalMoves(g, p) {
    const me = g.pawns[p];
    if (!me) return [];
    const out = [];
    const add = (x, y) => {
      if (pawnAt(g, x, y) < 0 && !out.some((m) => m.x === x && m.y === y)) out.push({ x, y });
    };
    for (const [dx, dy] of DIRS) {
      if (blocked(g.walls, me.x, me.y, dx, dy)) continue;
      const tx = me.x + dx, ty = me.y + dy;
      if (pawnAt(g, tx, ty) < 0) { add(tx, ty); continue; }
      // 앞에 말이 있으면 뛰어넘기. 뒤가 벽·판 끝·다른 말로 막히면 대각선으로
      if (!blocked(g.walls, tx, ty, dx, dy) && pawnAt(g, tx + dx, ty + dy) < 0) {
        add(tx + dx, ty + dy);
        continue;
      }
      for (const [sx, sy] of [[dy, dx], [-dy, -dx]]) {
        if (!blocked(g.walls, tx, ty, sx, sy)) add(tx + sx, ty + sy);
      }
    }
    return out;
  }

  // 말끼리는 무시하고, 벽만 보고 목표 줄까지 갈 수 있는지 (BFS)
  function hasPath(walls, p, from) {
    const seen = new Set([from.y * SIZE + from.x]);
    const queue = [from];
    while (queue.length) {
      const { x, y } = queue.shift();
      if (isGoal(p, x, y)) return true;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (blocked(walls, x, y, dx, dy) || seen.has(ny * SIZE + nx)) continue;
        seen.add(ny * SIZE + nx);
        queue.push({ x: nx, y: ny });
      }
    }
    return false;
  }

  // 벽을 놓을 수 없으면 이유 문자열, 놓을 수 있으면 null (남은 벽 개수는 따로 확인)
  function wallError(g, x, y, o) {
    if (o !== 'h' && o !== 'v') return '잘못된 벽입니다.';
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > SIZE - 2 || y > SIZE - 2) {
      return '판 밖에는 벽을 놓을 수 없습니다.';
    }
    const along = o === 'h' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    if (hasWall(g.walls, x, y, o) || along.some(([a, b]) => hasWall(g.walls, a, b, o))) {
      return '다른 벽과 겹칩니다.';
    }
    if (hasWall(g.walls, x, y, o === 'h' ? 'v' : 'h')) return '다른 벽과 교차합니다.';
    const walls = g.walls.concat([{ x, y, o }]);
    for (let p = 0; p < g.pawns.length; p++) {
      if (g.pawns[p] && !hasPath(walls, p, g.pawns[p])) return '말이 목표로 가는 길을 완전히 막을 수 없습니다.';
    }
    return null;
  }

  function applyMove(g, p, x, y) {
    g.pawns[p] = { x, y };
    g.last = { p, type: 'pawn', x, y };
  }

  function applyWall(g, p, x, y, o) {
    g.walls.push({ x, y, o, p });
    g.wallsLeft[p]--;
    g.last = { p, type: 'wall', x, y, o };
  }

  return {
    SIZE, WALLS, START,
    createGame, turnOrder, isGoal, blocked, legalMoves, hasPath, wallError, applyMove, applyWall,
  };
});
