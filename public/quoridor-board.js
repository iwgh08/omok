// 쿼리도 판 그리기와 입력. client.js가 env({canvas, ctx, $, state, emit, toast})를 넘겨 만든다
window.QUORIDOR_COLORS = ['#e53935', '#1e88e5', '#43a047', '#f9a825'];
window.QUORIDOR_COLOR_NAMES = ['빨강', '파랑', '초록', '노랑'];

window.QuoridorBoard = function (env) {
  const { SIZE } = Quoridor;
  const COLORS = window.QUORIDOR_COLORS;
  const { canvas, ctx } = env;
  let hover = null;      // 마우스 미리보기: {kind:'pawn', x, y} | {kind:'wall', x, y, o}
  let touchPick = null;  // 터치: 첫 탭으로 선택한 대상

  // 칸 9개와 홈 8개. 홈 너비는 칸의 1/4
  function geometry() {
    const w = canvas.width;
    const m = w * 0.045;
    const c = (w - 2 * m) / (SIZE + (SIZE - 1) * 0.25);
    const g = c * 0.25;
    const p = c + g;
    return { w, m, c, g, p, at: (i) => m + i * p };
  }

  function myTurn() {
    const s = env.state;
    return !!(s && s.status === 'playing' && s.you.seat >= 0 && s.q.pawns[s.you.seat] && s.turn === s.you.seat);
  }

  function legal() {
    return myTurn() ? Quoridor.legalMoves(env.state.q, env.state.you.seat) : [];
  }

  function wallOk(t) {
    const s = env.state;
    return s.q.wallsLeft[s.you.seat] > 0 && !Quoridor.wallError(s.q, t.x, t.y, t.o);
  }

  function wallRect(x, y, o) {
    const { c, g, at } = geometry();
    return o === 'h' ? [at(x), at(y) + c, 2 * c + g, g] : [at(x) + c, at(y), g, 2 * c + g];
  }

  function drawWall(x, y, o, fill, alpha = 1) {
    const [rx, ry, rw, rh] = wallRect(x, y, o);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = rh * 0.3;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, Math.min(rw, rh) * 0.3);
    ctx.fill();
    ctx.restore();
  }

  function drawPawn(x, y, color, alpha = 1) {
    const { c, at } = geometry();
    const cx = at(x) + c / 2, cy = at(y) + c / 2, r = c * 0.36;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = c * 0.12;
    ctx.shadowOffsetY = c * 0.05;
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#ffffffaa');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!canvas.width) return;
    const { w, m, c, g, at } = geometry();
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--wood-line').trim() || '#5a3e1b';
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = line;
    ctx.fillRect(0, 0, w, w);

    const s = env.state;
    const n = s ? s.players : 2;

    // 각 말의 목표 쪽 테두리 띠 (0: 위, 1: 아래, 2: 오른쪽, 3: 왼쪽)
    const band = m * 0.45;
    for (let p = 0; p < n; p++) {
      if (s && s.status !== 'waiting' && !s.q.pawns[p]) continue;
      ctx.fillStyle = COLORS[p];
      if (p === 0) ctx.fillRect(m, (m - band) / 2, w - 2 * m, band);
      if (p === 1) ctx.fillRect(m, w - (m + band) / 2, w - 2 * m, band);
      if (p === 2) ctx.fillRect(w - (m + band) / 2, m, band, w - 2 * m);
      if (p === 3) ctx.fillRect((m - band) / 2, m, band, w - 2 * m);
    }

    // 칸
    ctx.fillStyle = css.getPropertyValue('--wood').trim() || '#e2b866';
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        ctx.beginPath();
        ctx.roundRect(at(x), at(y), c, c, c * 0.08);
        ctx.fill();
      }
    }
    if (!s) return;
    const q = s.q;

    // 마지막 수 강조 (칸 또는 벽 테두리)
    const last = q.last;
    if (last) {
      ctx.strokeStyle = COLORS[last.p];
      ctx.lineWidth = Math.max(2, c * 0.06);
      if (last.type === 'pawn') {
        ctx.beginPath();
        ctx.roundRect(at(last.x) + 1, at(last.y) + 1, c - 2, c - 2, c * 0.08);
        ctx.stroke();
      }
    }

    // 이동 가능한 칸
    const moves = legal();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (const mv of moves) {
      ctx.beginPath();
      ctx.arc(at(mv.x) + c / 2, at(mv.y) + c / 2, c * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // 벽
    for (const wl of q.walls) drawWall(wl.x, wl.y, wl.o, COLORS[wl.p]);
    if (last && last.type === 'wall') {
      const [rx, ry, rw, rh] = wallRect(last.x, last.y, last.o);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, g * 0.18);
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, Math.min(rw, rh) * 0.3);
      ctx.stroke();
    }

    // 말
    q.pawns.forEach((pw, p) => pw && drawPawn(pw.x, pw.y, COLORS[p]));

    // 미리보기
    const t = touchPick || hover;
    if (t && myTurn()) {
      const alpha = touchPick ? 0.75 : 0.45;
      if (t.kind === 'pawn' && moves.some((mv) => mv.x === t.x && mv.y === t.y)) {
        drawPawn(t.x, t.y, COLORS[s.you.seat], alpha);
      } else if (t.kind === 'wall') {
        drawWall(t.x, t.y, t.o, wallOk(t) ? COLORS[s.you.seat] : '#555', alpha);
      }
    }
  }

  // 포인터 위치 → 칸 또는 벽 자리. 홈 근처면 벽, 아니면 칸
  function targetFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const { m, c, g, p } = geometry();
    const u = (e.clientX - rect.left) * scale - m;
    const v = (e.clientY - rect.top) * scale - m;
    const span = SIZE * p - g;
    if (u < -g || v < -g || u > span + g || v > span + g) return null;
    const clamp = (k) => Math.max(0, Math.min(SIZE - 2, k));
    // 가장 가까운 홈(k번 홈은 k열과 k+1열 사이)까지의 거리
    const groove = (z) => {
      const k = Math.max(0, Math.min(SIZE - 2, Math.round((z - c - g / 2) / p)));
      return { k, d: Math.abs(z - (k * p + c + g / 2)) };
    };
    const gx = groove(u), gy = groove(v);
    const near = g / 2 + c * 0.18;
    if (Math.min(gx.d, gy.d) < near) {
      // 벽은 포인터를 가운데로 두 칸에 걸치게
      if (gx.d < gy.d) return { kind: 'wall', o: 'v', x: gx.k, y: clamp(Math.round((v + g / 2) / p) - 1) };
      return { kind: 'wall', o: 'h', y: gy.k, x: clamp(Math.round((u + g / 2) / p) - 1) };
    }
    const x = Math.floor(u / p), y = Math.floor(v / p);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return { kind: 'pawn', x, y };
  }

  const same = (a, b) => !!a && !!b && a.kind === b.kind && a.x === b.x && a.y === b.y && a.o === b.o;

  // 둘 수 있는지 확인하고, explain이면 이유를 토스트로 알림
  function check(t, explain) {
    const s = env.state;
    const say = (msg) => { if (explain) env.toast(msg); return false; };
    if (!s || s.status !== 'playing') return false;
    if (s.you.seat < 0) return say('관전 중에는 둘 수 없습니다.');
    if (!s.q.pawns[s.you.seat]) return say('탈락해서 더 둘 수 없습니다.');
    if (s.turn !== s.you.seat) return say('내 차례가 아닙니다.');
    if (t.kind === 'pawn') {
      const me = s.q.pawns[s.you.seat];
      if (me.x === t.x && me.y === t.y) return false;
      return legal().some((mv) => mv.x === t.x && mv.y === t.y) || say('그 칸으로는 갈 수 없습니다.');
    }
    if (s.q.wallsLeft[s.you.seat] <= 0) return say('남은 벽이 없습니다.');
    const err = Quoridor.wallError(s.q, t.x, t.y, t.o);
    return err ? say(err) : true;
  }

  return {
    draw,
    reset() { touchPick = null; },
    pointerMove(e) {
      const t = targetFromEvent(e);
      if (!same(t, hover)) { hover = t; draw(); }
    },
    pointerLeave() { hover = null; draw(); },
    pointerUp(e) {
      const t = targetFromEvent(e);
      if (!t || !check(t, true)) return;
      // 터치는 실수 방지를 위해 같은 곳을 두 번 탭해야 확정
      if (e.pointerType !== 'mouse' && !same(t, touchPick)) {
        touchPick = t;
        draw();
        return;
      }
      touchPick = null;
      hover = null;
      env.emit('move', t.kind === 'pawn' ? { type: 'pawn', x: t.x, y: t.y } : { type: 'wall', x: t.x, y: t.y, o: t.o });
    },
  };
};
