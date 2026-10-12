// 오목 바둑판 그리기와 착수 입력. client.js가 env({canvas, ctx, $, state, emit, toast})를 넘겨 만든다
window.OmokBoard = function (env) {
  const { SIZE, EMPTY, BLACK } = Renju;
  const CENTER = Math.floor(SIZE / 2);
  const { canvas, ctx, $ } = env;
  let hover = null;       // 마우스 미리보기 위치
  let touchPick = null;   // 터치: 첫 탭으로 선택한 위치
  let forbiddenCache = { key: '', list: [] };

  function geometry() {
    const w = canvas.width;
    const cell = w / (SIZE + 1);
    return { w, cell, pos: (i) => cell + i * cell };
  }

  function forbiddenPoints() {
    const state = env.state;
    if (!state || state.status !== 'playing' || state.turn !== BLACK || state.moves.length === 0) return [];
    const key = state.moves.map((m) => m.join(',')).join(';');
    if (forbiddenCache.key !== key) {
      forbiddenCache = { key, list: Renju.allForbidden(state.board.slice()) };
    }
    return forbiddenCache.list;
  }

  function winningLine() {
    const state = env.state;
    if (!state || state.status !== 'ended' || state.reason !== 'five' || !state.moves.length) return null;
    const [x, y] = state.moves[state.moves.length - 1];
    const color = state.board[y * SIZE + x];
    const at = (i, j) => (i >= 0 && j >= 0 && i < SIZE && j < SIZE ? state.board[j * SIZE + i] : -1);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let a = 0, b = 0;
      while (at(x + (a + 1) * dx, y + (a + 1) * dy) === color) a++;
      while (at(x - (b + 1) * dx, y - (b + 1) * dy) === color) b++;
      if (a + b + 1 >= 5) return [[x - b * dx, y - b * dy], [x + a * dx, y + a * dy]];
    }
    return null;
  }

  function drawStone(x, y, color, alpha = 1) {
    const { cell, pos } = geometry();
    const cx = pos(x), cy = pos(y), r = cell * 0.46;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = cell * 0.12;
    ctx.shadowOffsetY = cell * 0.05;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    if (color === BLACK) { g.addColorStop(0, '#666'); g.addColorStop(1, '#0d0d0d'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfcfcf'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!canvas.width) return;
    const { w, cell, pos } = geometry();
    const css = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = css.getPropertyValue('--wood').trim() || '#e2b866';
    ctx.fillRect(0, 0, w, w);

    // 격자
    ctx.strokeStyle = css.getPropertyValue('--wood-line').trim() || '#5a3e1b';
    ctx.lineWidth = Math.max(1, w / 700);
    ctx.beginPath();
    for (let i = 0; i < SIZE; i++) {
      ctx.moveTo(pos(0), pos(i)); ctx.lineTo(pos(SIZE - 1), pos(i));
      ctx.moveTo(pos(i), pos(0)); ctx.lineTo(pos(i), pos(SIZE - 1));
    }
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      ctx.beginPath();
      ctx.arc(pos(x), pos(y), cell * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // 좌표
    ctx.font = `${cell * 0.32}px 'Noto Sans KR', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < SIZE; i++) {
      ctx.fillText(String.fromCharCode(65 + i), pos(i), cell * 0.4);
      ctx.fillText(String(SIZE - i), cell * 0.4, pos(i));
    }
    ctx.globalAlpha = 1;

    const state = env.state;
    if (!state) return;
    const board = state.board;

    // 돌
    const showNum = $('numToggle').checked;
    const order = new Map(state.moves.map(([x, y], i) => [y * SIZE + x, i + 1]));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = board[y * SIZE + x];
        if (c === EMPTY) continue;
        drawStone(x, y, c);
        if (showNum && order.has(y * SIZE + x)) {
          ctx.fillStyle = c === BLACK ? '#fff' : '#111';
          ctx.font = `bold ${cell * 0.36}px 'Noto Sans KR', sans-serif`;
          ctx.fillText(order.get(y * SIZE + x), pos(x), pos(y) + cell * 0.02);
        }
      }
    }

    // 마지막 수 표시
    if (state.moves.length && !showNum) {
      const [lx, ly] = state.moves[state.moves.length - 1];
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.arc(pos(lx), pos(ly), cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // 금수 표시
    if ($('forbidToggle').checked) {
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = Math.max(2, cell * 0.08);
      const d = cell * 0.18;
      for (const { x, y } of forbiddenPoints()) {
        ctx.beginPath();
        ctx.moveTo(pos(x) - d, pos(y) - d); ctx.lineTo(pos(x) + d, pos(y) + d);
        ctx.moveTo(pos(x) + d, pos(y) - d); ctx.lineTo(pos(x) - d, pos(y) + d);
        ctx.stroke();
      }
    }

    // 첫 수 안내
    if (state.status === 'playing' && state.moves.length === 0 && state.you.color === BLACK) {
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.beginPath();
      ctx.arc(pos(CENTER), pos(CENTER), cell * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 미리보기 돌
    const preview = touchPick || hover;
    if (preview && canPlace(preview.x, preview.y, false)) {
      drawStone(preview.x, preview.y, state.you.color, touchPick ? 0.7 : 0.45);
    }

    // 승리 줄
    const line = winningLine();
    if (line) {
      ctx.strokeStyle = 'rgba(229,57,53,0.85)';
      ctx.lineWidth = cell * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pos(line[0][0]), pos(line[0][1]));
      ctx.lineTo(pos(line[1][0]), pos(line[1][1]));
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  function canPlace(x, y, explain) {
    const s = env.state;
    const say = (m) => { if (explain) env.toast(m); return false; };
    if (!s || s.status !== 'playing') return false;
    if (!s.you.color) return say('관전 중에는 돌을 둘 수 없습니다.');
    if (s.you.color !== s.turn) return say('상대 차례입니다.');
    if (s.board[y * SIZE + x] !== EMPTY) return false;
    if (s.moves.length === 0 && (x !== CENTER || y !== CENTER)) return say('흑의 첫 수는 정중앙(천원)에 두어야 합니다.');
    if (s.you.color === BLACK) {
      const f = forbiddenPoints().find((p) => p.x === x && p.y === y);
      if (f) return say(`${Renju.FORBIDDEN_NAMES[f.type]} 자리입니다.`);
    }
    return true;
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const { cell } = geometry();
    const x = Math.round(((e.clientX - rect.left) * scale - cell) / cell);
    const y = Math.round(((e.clientY - rect.top) * scale - cell) / cell);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return { x, y };
  }

  return {
    draw,
    reset() { touchPick = null; },
    pointerMove(e) {
      const p = pointFromEvent(e);
      if (p?.x !== hover?.x || p?.y !== hover?.y) { hover = p; draw(); }
    },
    pointerLeave() { hover = null; draw(); },
    pointerUp(e) {
      const p = pointFromEvent(e);
      if (!p || !canPlace(p.x, p.y, true)) return;
      // 터치는 실수 방지를 위해 같은 자리를 두 번 탭해야 착수
      if (e.pointerType !== 'mouse' && !(touchPick && touchPick.x === p.x && touchPick.y === p.y)) {
        touchPick = p;
        draw();
        return;
      }
      touchPick = null;
      hover = null;
      env.emit('place', p);
    },
  };
};
