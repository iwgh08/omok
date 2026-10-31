// 쿼리도 판 그리기와 입력. client.js가 env({canvas, ctx, $, state, emit, toast})를 넘겨 만든다
window.QuoridorBoard = function (env) {
  const { SIZE } = Quoridor;
  const COLORS = window.SEAT_COLORS;
  const { canvas, ctx } = env;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const boardLayer = document.createElement('canvas'); // 테두리와 칸을 미리 그려 두는 곳
  let boardKey = '';     // boardLayer를 그릴 때 쓴 크기와 색
  let hover = null;      // 마우스 미리보기: {kind:'pawn', x, y} | {kind:'wall', x, y, o}
  let touchPick = null;  // 터치: 첫 탭으로 선택한 대상
  let effects = [];      // 진행 중인 애니메이션: {id, kind, start, ms, ...}
  let frame = 0;         // 예약된 다음 프레임 (0이면 없음)

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

  // '#rrggbb'를 밝게(amt > 0) 또는 어둡게(amt < 0) 만든다
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (v) => Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt));
    return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  }

  // 조건에 맞는 칸들의 모양
  function tiles(match) {
    const { c, at } = geometry();
    const path = new Path2D();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (match(x, y)) path.roundRect(at(x), at(y), c, c, c * 0.08);
      }
    }
    return path;
  }

  // ---------- 판 배경 ----------
  // 고정 시드 난수: 크기가 바뀌어도 나뭇결 무늬가 달라지지 않는다
  function seeded(seed) {
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
  }

  // 판을 가로지르는 나뭇결. 모든 줄이 같은 물결을 따라서 결끼리 교차하지 않는다
  function paintGrain(b, w, rand, light, dark) {
    const lines = 64;
    const wave = (u, v) => 0.02 * Math.sin(u * 3.5 + v * 5) + 0.008 * Math.sin(u * 8 + v * 11);
    for (let i = 0; i < lines; i++) {
      const v = (i + rand()) / lines;
      b.strokeStyle = rand() < 0.65 ? dark : light;
      b.globalAlpha = 0.05 + rand() * 0.12;
      b.lineWidth = w * (0.0008 + rand() * 0.003);
      b.beginPath();
      for (let k = 0; k <= 48; k++) {
        const u = k / 48;
        b.lineTo(u * w, (v + wave(u, v)) * w);
      }
      b.stroke();
    }
    b.globalAlpha = 1;
  }

  // 테두리와 칸은 크기나 색이 바뀔 때만 다시 그린다
  function paintBoard(wood, line) {
    const { w, m, c, g } = geometry();
    const key = `${w}|${wood}|${line}`;
    if (key === boardKey) return;
    boardKey = key;
    boardLayer.width = boardLayer.height = w;
    const b = boardLayer.getContext('2d');
    const rand = seeded(9);

    // 테두리
    b.fillStyle = line;
    b.fillRect(0, 0, w, w);
    paintGrain(b, w, rand, shade(line, 0.3), shade(line, -0.45));

    // 칸이 놓인 바닥: 테두리보다 어둡게 파인 느낌
    const inset = m - g * 0.35, span = w - 2 * inset;
    b.fillStyle = shade(line, -0.3);
    b.beginPath();
    b.roundRect(inset, inset, span, span, c * 0.1);
    b.fill();

    // 칸: 한 장의 나무에 홈을 판 것처럼 나뭇결이 칸을 가로질러 이어진다
    const all = tiles(() => true);
    b.save();
    b.translate(0, c * 0.035);
    b.fillStyle = 'rgba(0,0,0,0.5)';
    b.fill(all);
    b.restore();
    b.save();
    b.clip(all);
    b.fillStyle = wood;
    b.fillRect(0, 0, w, w);
    paintGrain(b, w, rand, shade(wood, 0.45), shade(wood, -0.4));
    const light = b.createLinearGradient(0, 0, w, w);
    light.addColorStop(0, 'rgba(255,255,255,0.14)');
    light.addColorStop(1, 'rgba(0,0,0,0.1)');
    b.fillStyle = light;
    b.fillRect(0, 0, w, w);
    // 칸 모서리: 위·왼쪽은 밝게, 아래·오른쪽은 어둡게
    const bevel = Math.max(1, c * 0.03);
    b.lineWidth = bevel * 2;
    b.translate(bevel, bevel);
    b.strokeStyle = 'rgba(255,255,255,0.4)';
    b.stroke(all);
    b.translate(-2 * bevel, -2 * bevel);
    b.strokeStyle = 'rgba(0,0,0,0.25)';
    b.stroke(all);
    b.restore();
  }

  // ---------- 벽과 말 ----------
  // 왼쪽 위에서 빛이 오는 막대 (벽, 목표 띠)
  function paintBar(rx, ry, rw, rh, color) {
    const thin = Math.min(rw, rh);
    const grad = rw > rh ? ctx.createLinearGradient(0, ry, 0, ry + rh) : ctx.createLinearGradient(rx, 0, rx + rw, 0);
    grad.addColorStop(0, shade(color, 0.45));
    grad.addColorStop(0.45, color);
    grad.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = grad;
    ctx.strokeStyle = shade(color, -0.55);
    ctx.lineWidth = Math.max(1, thin * 0.09);
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, thin * 0.3);
    ctx.fill();
    ctx.stroke();
  }

  function drawWall(x, y, o, color, { alpha = 1, lift = 0, scale = 1 } = {}) {
    const [rx, ry, rw, rh] = wallRect(x, y, o);
    const thin = Math.min(rw, rh);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.roundRect(rx + thin * 0.12 + lift * 0.3, ry + thin * 0.18 + lift * 0.5, rw, rh, thin * 0.3);
    ctx.fill();
    ctx.translate(rx + rw / 2, ry + rh / 2 - lift);
    ctx.scale(scale, scale);
    paintBar(-rw / 2, -rh / 2, rw, rh, color);
    ctx.restore();
  }

  // 놓을 수 없는 자리: 빨간 벽과 ✕
  function drawBlockedWall(x, y, o, alpha) {
    const { g } = geometry();
    const [rx, ry, rw, rh] = wallRect(x, y, o);
    const cx = rx + rw / 2, cy = ry + rh / 2, r = g * 0.85, d = r * 0.42;
    drawWall(x, y, o, '#c62828', { alpha });
    ctx.save();
    ctx.fillStyle = '#c62828';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, r * 0.3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
    ctx.restore();
  }

  function disc(cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // (cx, cy)는 말이 놓인 바닥 지점. lift만큼 뜨면 그림자는 바닥에 남아 작고 옅어진다
  function drawPawn(cx, cy, color, { alpha = 1, lift = 0, scale = 1 } = {}) {
    const { c } = geometry();
    const air = lift / c;
    const r = c * 0.36 * (1 + air * 0.22) * scale, y = cy - lift;
    ctx.save();
    ctx.globalAlpha = alpha;

    // 그림자
    const sx = cx + c * (0.03 + air * 0.12), sy = cy + c * (0.05 + air * 0.16), sr = r * (1.14 - air * 0.5);
    const shadow = ctx.createRadialGradient(sx, sy, sr * 0.45, sx, sy, sr);
    shadow.addColorStop(0, `rgba(0,0,0,${0.5 - air * 0.5})`);
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    disc(sx, sy, sr);

    // 받침: 어두운 테두리로 나무색 위에서도 윤곽이 보이게 한다
    ctx.fillStyle = shade(color, -0.6);
    disc(cx, y, r);
    const base = ctx.createLinearGradient(cx - r, y - r, cx + r, y + r);
    base.addColorStop(0, shade(color, 0.2));
    base.addColorStop(1, shade(color, -0.4));
    ctx.fillStyle = base;
    disc(cx, y, r * 0.92);

    // 머리: 빛을 받은 둥근 윗부분
    const hx = cx - r * 0.04, hy = y - r * 0.06, hr = r * 0.68;
    const dome = ctx.createRadialGradient(hx - hr * 0.35, hy - hr * 0.4, hr * 0.08, hx, hy, hr);
    dome.addColorStop(0, shade(color, 0.6));
    dome.addColorStop(0.55, color);
    dome.addColorStop(1, shade(color, -0.28));
    ctx.fillStyle = dome;
    disc(hx, hy, hr);

    // 광택
    const gx = hx - hr * 0.36, gy = hy - hr * 0.42, gr = hr * 0.42;
    const gloss = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    gloss.addColorStop(0, 'rgba(255,255,255,0.75)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    disc(gx, gy, gr);
    ctx.restore();
  }

  // 말 아래 바닥의 고리 (현재 차례, 승자)
  function drawRing(cx, cy, color) {
    const { c } = geometry();
    const width = Math.max(2, c * 0.05);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, c * 0.44, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = width + Math.max(2, c * 0.03);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  // 목표 쪽 표시: 테두리 띠와, 띠의 색이 목표 줄 칸으로 번지는 빛 (0: 위, 1: 아래, 2: 오른쪽, 3: 왼쪽)
  function drawGoal(p) {
    const { w, m, c } = geometry();
    const band = m * 0.45, near = (m - band) / 2, far = w - (m + band) / 2, len = w - 2 * m;
    const edge = [[0, m, 0, m + c], [0, w - m, 0, w - m - c], [w - m, 0, w - m - c, 0], [m, 0, m + c, 0]][p];
    const glow = ctx.createLinearGradient(...edge);
    glow.addColorStop(0, `${COLORS[p]}90`);
    glow.addColorStop(0.75, `${COLORS[p]}00`);
    ctx.fillStyle = glow;
    ctx.fill(tiles((x, y) => Quoridor.isGoal(p, x, y)));
    const rect = [[m, near, len, band], [m, far, len, band], [far, m, band, len], [near, m, band, len]][p];
    paintBar(...rect, COLORS[p]);
  }

  // 칸을 밝히고 테두리를 두른다 (이동 가능한 칸, 마지막 수)
  function markTile(x, y, color, light) {
    const { c, at } = geometry();
    ctx.fillStyle = `rgba(255,255,255,${light})`;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, c * 0.05);
    ctx.beginPath();
    ctx.roundRect(at(x) + 1, at(y) + 1, c - 2, c - 2, c * 0.08);
    ctx.fill();
    ctx.stroke();
  }

  // ---------- 애니메이션 ----------
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const progress = (f) => Math.min(1, (performance.now() - f.start) / f.ms);
  const wallId = (wl) => `wall:${wl.x},${wl.y},${wl.o}`;
  const findEffect = (id) => effects.find((f) => f.id === id);

  // 같은 대상에 걸린 효과는 새 것으로 바꾼다
  function addEffect(f) {
    effects = effects.filter((e) => e.id !== f.id);
    effects.push({ ...f, start: performance.now() });
  }

  // 이전 상태와 비교해 움직인 말과 바뀐 벽에 효과를 건다.
  // q.last는 쓰지 않는다 (무르기로 되돌린 상태의 last는 직전의 다른 수를 가리킨다)
  function onState(prev, s) {
    const sameRoom = prev?.game === 'quoridor' && prev.code === s.code;
    if (!sameRoom || (s.status === 'playing' && prev.status !== 'playing')) effects = [];
    if (!sameRoom || prev.status !== 'playing' || reducedMotion.matches) return;

    prev.q.pawns.forEach((from, p) => {
      const to = s.q.pawns[p];
      if (!from) return;
      if (!to) {
        addEffect({ id: `pawn:${p}`, kind: 'out', p, x: from.x, y: from.y, ms: 300 });
        return;
      }
      // 2칸보다 멀면 재접속 등으로 수를 놓친 것이므로 바로 표시한다
      const cells = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (cells === 1) addEffect({ id: `pawn:${p}`, kind: 'move', from, to, height: 0.18, ms: 220 });
      if (cells === 2) addEffect({ id: `pawn:${p}`, kind: 'move', from, to, height: 0.5, ms: 320 });
    });

    const has = (walls, wl) => walls.some((other) => wallId(other) === wallId(wl));
    for (const wl of s.q.walls) {
      if (!has(prev.q.walls, wl)) addEffect({ id: wallId(wl), kind: 'wallIn', ms: 200 });
    }
    for (const wl of prev.q.walls) {
      if (!has(s.q.walls, wl)) addEffect({ id: wallId(wl), kind: 'wallOut', wall: wl, ms: 200 });
    }
  }

  // 말이 지금 보이는 위치. 움직이는 중이면 칸 사이 좌표와 공중 높이(픽셀)
  function pawnPose(p, pw) {
    const f = findEffect(`pawn:${p}`);
    if (!f) return { p, x: pw.x, y: pw.y, lift: 0 };
    const t = progress(f), e = easeInOut(t);
    return {
      p,
      x: f.from.x + (f.to.x - f.from.x) * e,
      y: f.from.y + (f.to.y - f.from.y) * e,
      lift: Math.sin(Math.PI * t) * geometry().c * f.height,
    };
  }

  function tick() {
    frame = 0;
    // 애니메이션 중에 로비로 나갔거나 오목 방으로 옮겼으면 그리지 않는다
    if (env.state?.game !== 'quoridor') {
      effects = [];
      return;
    }
    draw();
  }

  // ---------- 그리기 ----------
  function draw() {
    if (!canvas.width) return;
    const { c, g, at } = geometry();
    const css = getComputedStyle(document.documentElement);
    paintBoard(css.getPropertyValue('--wood').trim() || '#e2b866', css.getPropertyValue('--wood-line').trim() || '#5a3e1b');
    effects = effects.filter((f) => progress(f) < 1);
    ctx.drawImage(boardLayer, 0, 0);

    const s = env.state;
    if (!s) return;
    const q = s.q;
    const center = (i) => at(i) + c / 2;

    for (let p = 0; p < s.players; p++) {
      if (s.status === 'waiting' || q.pawns[p]) drawGoal(p);
    }

    // 마지막 수 강조 (칸 또는 벽 테두리)
    const last = q.last;
    if (last && last.type === 'pawn') markTile(last.x, last.y, COLORS[last.p], 0.15);

    // 이동 가능한 칸 (미리보기 말이 올라간 칸은 점을 빼서 비쳐 보이지 않게 한다)
    const pick = touchPick || hover;
    const moves = legal();
    for (const mv of moves) {
      const mine = COLORS[s.you.seat];
      markTile(mv.x, mv.y, `${mine}b0`, 0.32);
      if (same(pick, { kind: 'pawn', x: mv.x, y: mv.y })) continue;
      ctx.fillStyle = shade(mine, -0.1);
      disc(center(mv.x), center(mv.y), c * 0.1);
    }

    // 벽
    for (const wl of q.walls) {
      const f = findEffect(wallId(wl));
      const t = f ? easeOut(progress(f)) : 1;
      drawWall(wl.x, wl.y, wl.o, COLORS[wl.p], { alpha: t, lift: (1 - t) * c * 0.3, scale: 1 + (1 - t) * 0.2 });
    }
    for (const f of effects) {
      if (f.kind !== 'wallOut') continue;
      const t = progress(f);
      drawWall(f.wall.x, f.wall.y, f.wall.o, COLORS[f.wall.p], { alpha: 1 - t, lift: t * c * 0.12 });
    }
    if (last && last.type === 'wall' && !findEffect(wallId(last))) {
      const [rx, ry, rw, rh] = wallRect(last.x, last.y, last.o);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, g * 0.18);
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, Math.min(rw, rh) * 0.3);
      ctx.stroke();
    }

    // 말: 떠 있는 말이 다른 말 위로 지나가도록 맨 나중에 그린다
    const poses = q.pawns.map((pw, p) => pw && pawnPose(p, pw)).filter(Boolean).sort((a, b) => a.lift - b.lift);
    const ringOf = s.status === 'playing' ? s.turn : s.status === 'ended' ? s.winner : null;
    for (const pose of poses) {
      if (pose.p === ringOf) drawRing(center(pose.x), center(pose.y), s.status === 'ended' ? '#ffd54f' : '#fff');
    }
    for (const f of effects) {
      if (f.kind !== 'out') continue;
      const t = progress(f);
      drawPawn(center(f.x), center(f.y), COLORS[f.p], { alpha: 1 - t, scale: 1 - t * 0.5 });
    }
    for (const pose of poses) drawPawn(center(pose.x), center(pose.y), COLORS[pose.p], { lift: pose.lift });

    // 미리보기
    if (pick && myTurn()) {
      const alpha = touchPick ? 0.75 : 0.45;
      if (pick.kind === 'pawn' && moves.some((mv) => mv.x === pick.x && mv.y === pick.y)) {
        drawPawn(center(pick.x), center(pick.y), COLORS[s.you.seat], { alpha });
      } else if (pick.kind === 'wall') {
        if (wallOk(pick)) drawWall(pick.x, pick.y, pick.o, COLORS[s.you.seat], { alpha });
        else drawBlockedWall(pick.x, pick.y, pick.o, alpha);
      }
    }

    if (effects.length && !frame) frame = requestAnimationFrame(tick);
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
    onState,
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
