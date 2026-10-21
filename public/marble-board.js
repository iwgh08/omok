// 부루마블 판 그리기와 입력. client.js가 env({canvas, ctx, $, state, emit, toast})를 넘겨 만든다
// 판 가운데의 #marblePanel(주사위, 행동 버튼, 기록)도 여기서 그린다
window.MarbleBoard = function (env) {
  const { SIZE, BOARD, KINDS, KIND_NAMES, MAX, SPACE, COLUMBIA, SPACE_FEE, money } = Marble;
  const COLORS = window.SEAT_COLORS;
  const GROUP_COLORS = ['#ef9a9a', '#f48fb1', '#ce93d8', '#9fa8da', '#81d4fa', '#80cbc4', '#c5e1a5', '#ffcc80'];
  const TOUR_COLOR = '#90a4ae';
  const ICONS = { start: '🏁', island: '🏝️', fundGet: '💰', space: '🚀', key: '🔑', fundPay: '💸' };
  const BUILD_ICONS = { villa: '🏠', building: '🏢', hotel: '🏨' };
  const DESC = {
    start: `지나거나 도착하면 월급 ${money(Marble.SALARY)}`,
    island: '도착하면 3턴 쉼. 더블이 나오면 바로 탈출',
    fundGet: '모인 사회복지기금을 모두 받음',
    space: `다음 차례에 원하는 칸으로 이동 (컬럼비아호 주인에게 탑승료 ${money(SPACE_FEE)})`,
    key: '황금열쇠 카드를 한 장 뽑음',
    fundPay: `사회복지기금 ${money(Marble.FUND_PAY)}을 냄`,
  };
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const N = 11; // 한 변의 칸 수 (모서리 포함)
  const { canvas, ctx, $ } = env;
  const panel = $('marblePanel');

  let hover = null;      // 마우스가 올라간 칸
  let selected = null;   // 고른 칸 (매각·여행 대상, 또는 정보 보기)
  let choice = { villa: 0, building: 0, hotel: 0 }; // 건설 단계에서 고른 건물 수
  let seen = { code: null, seq: -1 }; // 마지막으로 반영한 상태
  let target = [];       // 말의 실제 위치
  let shown = [];        // 화면에 그리는 말 위치 (이동 애니메이션 중에는 target과 다름)
  let frames = [];       // 남은 애니메이션 프레임 [{p, pos, wait}]
  let animTimer = null;
  let panelKey = '';
  let sentAt = 0;

  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const nameOf = (s, p) => s.names[p] || s.seats[p]?.name || window.SEAT_COLOR_NAMES[p];
  const btn = (act, label, cls = '', disabled = false) =>
    `<button data-act="${act}" class="${cls}"${disabled ? ' disabled' : ''}>${label}</button>`;
  const dieHtml = (v) => `<span class="die">${Array.from({ length: 9 }, (_, i) => `<i${PIPS[v].includes(i) ? ' class="on"' : ''}></i>`).join('')}</span>`;

  function myTurn(s) {
    return !!(s && s.m && s.status === 'playing' && s.you.seat >= 0 && !s.m.players[s.you.seat].out && s.turn === s.you.seat);
  }

  // 칸 번호 → 격자 위치. 출발은 오른쪽 아래, 번호가 커지면 아래 줄을 왼쪽으로 → 왼쪽 줄을 위로 → …
  function cellRect(sq) {
    const c = canvas.width / N;
    let col, row;
    if (sq <= 10) { col = 10 - sq; row = 10; }
    else if (sq <= 20) { col = 0; row = 20 - sq; }
    else if (sq <= 30) { col = sq - 20; row = 0; }
    else { col = 10; row = sq - 30; }
    return { x: col * c, y: row * c, c };
  }

  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const c = canvas.width / N;
    const col = Math.floor(((e.clientX - rect.left) * scale) / c);
    const row = Math.floor(((e.clientY - rect.top) * scale) / c);
    if (col < 0 || row < 0 || col >= N || row >= N) return null;
    if (row === 10) return 10 - col;
    if (col === 0) return 20 - row;
    if (row === 0) return 20 + col;
    if (col === 10) return 30 + row;
    return null;
  }

  // 너비에 맞을 때까지 글자 크기를 줄임
  function fitFont(text, maxW, px, bold) {
    let size = px;
    do {
      ctx.font = `${bold ? '700 ' : ''}${size}px 'Noto Sans KR', sans-serif`;
      size *= 0.9;
    } while (ctx.measureText(text).width > maxW && size > 4);
  }

  // 지금 고를 수 있는 칸 (매각 단계: 내 땅, 여행 단계: 우주여행 칸 말고 전부)
  function selectable(s, sq) {
    if (!myTurn(s)) return false;
    if (s.m.phase === 'sell') return s.m.owner[sq] === s.you.seat;
    if (s.m.phase === 'travel') return sq !== SPACE;
    return false;
  }

  function drawCell(sq, s, css) {
    const m = s && s.m;
    const cell = BOARD[sq];
    const { x, y, c } = cellRect(sq);
    const gap = c * 0.03;
    const cx = x + c / 2;
    const inner = c * 0.86;
    const owner = m ? m.owner[sq] : null;
    ctx.fillStyle = css('--panel', '#ffffff');
    ctx.fillRect(x + gap, y + gap, c - 2 * gap, c - 2 * gap);
    if (owner !== null) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = COLORS[owner];
      ctx.fillRect(x + gap, y + gap, c - 2 * gap, c - 2 * gap);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS[owner];
      ctx.fillRect(x + gap, y + c - gap - c * 0.08, c - 2 * gap, c * 0.08);
    }

    const prop = cell.type === 'city' || cell.type === 'tour';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (prop) {
      const band = c * 0.22;
      ctx.fillStyle = cell.type === 'tour' ? TOUR_COLOR : GROUP_COLORS[cell.group];
      ctx.fillRect(x + gap, y + gap, c - 2 * gap, band);
      if (m && cell.type === 'city') {
        const b = m.buildings[sq];
        const icons = KINDS.map((k) => BUILD_ICONS[k].repeat(b[k])).join('');
        if (icons) {
          fitFont(icons, inner, band * 0.8);
          ctx.fillText(icons, cx, y + gap + band / 2);
        }
      }
      ctx.fillStyle = css('--text', '#2b2620');
      fitFont(cell.short, inner, c * 0.17, true);
      ctx.fillText(cell.short, cx, y + c * 0.45);
      const label = owner !== null ? `통행 ${money(Marble.toll(m, sq))}` : money(cell.price);
      ctx.fillStyle = owner !== null ? css('--text', '#2b2620') : css('--muted', '#8a8075');
      fitFont(label, inner, c * 0.14, owner !== null);
      ctx.fillText(label, cx, y + c * 0.71);
    } else {
      const corner = sq % 10 === 0;
      ctx.font = `${c * (corner ? 0.34 : 0.26)}px sans-serif`;
      ctx.fillText(ICONS[cell.type], cx, y + c * (corner ? 0.4 : 0.4));
      ctx.fillStyle = css('--text', '#2b2620');
      fitFont(cell.short, inner, c * (corner ? 0.17 : 0.14), true);
      ctx.fillText(cell.short, cx, y + c * 0.77);
    }

    // 테두리: 고른 칸 > 고를 수 있는 칸 > 마우스가 올라간 칸
    const accent = css('--accent', '#b5651d');
    const stroke = (width, dash) => {
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.strokeRect(x + gap + width / 2, y + gap + width / 2, c - 2 * gap - width, c - 2 * gap - width);
      ctx.restore();
    };
    if (selected === sq) stroke(Math.max(3, c * 0.07));
    else if (s && selectable(s, sq)) stroke(Math.max(1.5, c * 0.03), [c * 0.08, c * 0.06]);
    else if (hover === sq) stroke(Math.max(1, c * 0.025));
  }

  function drawPawns(s) {
    const m = s.m;
    const at = {}; // 위치 → 그 칸에 있는 자리들
    m.players.forEach((pl, p) => {
      if (pl.out || (s.status === 'waiting' && !s.seats[p])) return;
      const pos = shown[p] ?? pl.pos;
      (at[pos] = at[pos] || []).push(p);
    });
    for (const [pos, list] of Object.entries(at)) {
      const { x, y, c } = cellRect(Number(pos));
      const r = c * 0.12;
      list.forEach((p, k) => {
        const ox = list.length === 1 ? 0 : (k % 2 ? 1 : -1) * r * 1.1;
        const oy = list.length <= 2 ? 0 : (k < 2 ? -1 : 1) * r * 1.1;
        const px = x + c / 2 + ox, py = y + c * 0.68 + oy; // 칸 이름을 가리지 않게 아래쪽에
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = c * 0.08;
        ctx.shadowOffsetY = c * 0.03;
        const grad = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
        grad.addColorStop(0, '#ffffffaa');
        grad.addColorStop(0.3, COLORS[p]);
        grad.addColorStop(1, COLORS[p]);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (s.status === 'playing' && s.turn === p) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(1.5, c * 0.03);
          ctx.beginPath();
          ctx.arc(px, py, r + ctx.lineWidth, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  function draw() {
    if (!canvas.width) return;
    const s = env.state;
    const w = canvas.width;
    const style = getComputedStyle(document.documentElement);
    const css = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = css('--wood', '#e2b866');
    ctx.fillRect(0, 0, w, w);
    for (let sq = 0; sq < SIZE; sq++) drawCell(sq, s, css);
    if (s && s.m) drawPawns(s);
    renderPanel();
  }

  // ---------- 말 이동 애니메이션 ----------
  function stopAnim() {
    clearTimeout(animTimer);
    animTimer = null;
    frames = [];
  }

  function play() {
    if (!frames.length) return;
    const tick = () => {
      const f = frames.shift();
      if (!f) {
        animTimer = null;
        shown = target.slice();
        draw();
        return;
      }
      shown[f.p] = f.pos;
      draw();
      animTimer = setTimeout(tick, frames.length ? frames[0].wait : 0);
    };
    animTimer = setTimeout(tick, frames[0].wait);
  }

  // 새 상태가 오면: 행동이 반영됐으면(seq 증가) 그 경로를 따라 말을 움직인다
  function sync() {
    const s = env.state;
    if (!s || !s.m) return;
    const m = s.m;
    const actual = m.players.map((p) => p.pos);
    if (s.code !== seen.code || m.seq < seen.seq || s.status === 'waiting' || target.length !== actual.length) {
      stopAnim();
      seen = { code: s.code, seq: m.seq };
      target = actual;
      shown = actual.slice();
      return;
    }
    if (m.seq === seen.seq) return;
    seen.seq = m.seq;
    selected = null;
    choice = { villa: 0, building: 0, hotel: 0 };
    stopAnim();
    shown = target.slice(); // 아직 끝나지 않은 지난 애니메이션은 건너뜀
    target = actual;
    for (const seg of m.path) {
      if (seg.walk) {
        for (let pos = seg.from; pos !== seg.to;) {
          pos = (pos + 1) % SIZE;
          frames.push({ p: seg.p, pos, wait: 110 });
        }
      } else {
        frames.push({ p: seg.p, pos: seg.to, wait: 350 });
      }
    }
    if (frames.length) play();
    else shown = target.slice();
  }

  // ---------- 가운데 패널 ----------
  function actions(s) {
    const m = s.m, me = s.you.seat;
    const pl = m.players[me];
    const sq = pl.pos, cell = BOARD[sq];
    const cash = `<small>내 돈 ${money(pl.cash)}</small>`;
    switch (m.phase) {
      case 'roll': {
        const island = pl.island ? `<p>🏝️ 무인도 · ${pl.island}턴 남음<br><small>${pl.escape ? '탈출권을 씁니다' : '더블이 나오면 탈출'}</small></p>` : '';
        return `${island}${btn('roll', '🎲 주사위 굴리기', 'primary big')}`;
      }
      case 'travel': {
        const owner = m.owner[COLUMBIA];
        const fee = owner !== null && owner !== me ? SPACE_FEE : 0;
        const go = selected === null ? ''
          : fee > pl.cash ? `<p><small>탑승료 ${money(fee)}가 모자라 여행할 수 없습니다</small></p>`
          : btn('travel', `🚀 ${esc(BOARD[selected].name)}(으)로${fee ? ` · 탑승료 ${money(fee)}` : ''}`, 'primary');
        return `<p>🚀 우주여행: 판에서 갈 칸을 고르세요</p>${go}${btn('roll', '여행 안 하고 굴리기')}`;
      }
      case 'buy':
        return `<p><b>${esc(cell.name)}</b> ${money(cell.price)} · 살까요?<br>` +
          `<small>통행료 ${money(Marble.toll(m, sq))}${cell.type === 'tour' ? ' (관광지)' : ''} · 내 돈 ${money(pl.cash)}</small></p>` +
          `<div class="row">${btn('buy', '사기', 'primary')}${btn('skip', '안 사기')}</div>`;
      case 'build': {
        const cost = Marble.buildCost(sq), b = m.buildings[sq];
        const total = KINDS.reduce((t, k) => t + choice[k] * cost[k], 0);
        const after = { ...b };
        KINDS.forEach((k) => (after[k] += choice[k]));
        const rows = KINDS.filter((k) => b[k] < MAX[k]).map((k) => {
          const canMore = b[k] + choice[k] < MAX[k] && total + cost[k] <= pl.cash;
          return `<div class="mp-build"><span>${BUILD_ICONS[k]} ${KIND_NAMES[k]} <small>${money(cost[k])}</small></span>` +
            `<button data-act="less" data-kind="${k}"${choice[k] ? '' : ' disabled'}>−</button><b>${choice[k]}</b>` +
            `<button data-act="more" data-kind="${k}"${canMore ? '' : ' disabled'}>+</button></div>`;
        }).join('');
        const toll = `통행료 ${money(Marble.toll(m, sq))}${total ? ` → ${money(Marble.toll({ buildings: { [sq]: after } }, sq))}` : ''}`;
        return `<p><b>${esc(cell.name)}</b>에 건물을 지을까요?<br><small>${toll} · 내 돈 ${money(pl.cash)}</small></p>${rows}` +
          `<div class="row">${btn('build', total ? `짓기 (${money(total)})` : '짓기', 'primary', !total)}${btn('skip', '안 짓기')}</div>`;
      }
      case 'sell': {
        const sell = selected !== null && m.owner[selected] === me
          ? btn('sell', `${esc(BOARD[selected].name)} 팔기 (+${money(Marble.sellValue(m, selected))})`, 'primary')
          : '';
        return `<p>낼 돈 <b>${money(m.pending.debt)}</b> · ${cash}<br><small>판에서 팔 내 땅을 고르세요 (땅값과 건물값의 절반)</small></p>` +
          `${sell}${btn('autoSell', '싼 땅부터 자동 매각')}`;
      }
    }
    return '';
  }

  function info(s, sq) {
    const m = s.m, cell = BOARD[sq];
    const lines = [];
    if (Marble.isProperty(sq)) {
      const owner = m.owner[sq];
      lines.push(`땅값 ${money(cell.price)} · 통행료 ${money(Marble.toll(m, sq))}`);
      lines.push(owner === null ? '주인 없음' : `주인 <b style="color:${COLORS[owner]}">●</b> ${esc(nameOf(s, owner))}`);
      if (cell.type === 'city') {
        const cost = Marble.buildCost(sq), b = m.buildings[sq];
        lines.push(`건물값 ${KINDS.map((k) => `${KIND_NAMES[k]} ${money(cost[k])}`).join(' · ')}`);
        const built = KINDS.filter((k) => b[k]).map((k) => `${KIND_NAMES[k]} ${b[k]}`).join(', ');
        if (built) lines.push(`지은 건물: ${built}`);
      } else {
        lines.push('관광지: 건물을 지을 수 없습니다');
      }
    } else {
      lines.push(DESC[cell.type]);
    }
    return `<div class="mp-info"><b>${ICONS[cell.type] || ''} ${esc(cell.name)}</b>${btn('closeInfo', '✕', 'small ghost')}` +
      `${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
  }

  function ranking(s) {
    const m = s.m;
    const order = Marble.turnOrder(m.n).sort((a, b) => Marble.assets(m, b) - Marble.assets(m, a));
    return `<div class="mp-rank"><b>최종 자산</b>${order.map((p) =>
      `<div><span style="color:${COLORS[p]}">●</span> ${esc(nameOf(s, p))} <b>${m.players[p].out ? '탈락' : money(Marble.assets(m, p))}</b></div>`).join('')}</div>`;
  }

  function renderPanel() {
    const s = env.state;
    if (!s || !s.m) return;
    const m = s.m;
    const key = [s.code, s.status, m.seq, s.turn, s.you.seat, selected, choice.villa, choice.building, choice.hotel, !!animTimer].join('|');
    if (key === panelKey) return;
    panelKey = key;
    const parts = [];
    const round = s.status === 'waiting' ? '대기 중' : `${Math.min(m.round, m.maxRounds)} / ${m.maxRounds}턴`;
    parts.push(`<div class="mp-top"><span>${round}</span><span>💰 사회복지기금 ${money(m.fund)}</span></div>`);
    if (m.dice && s.status !== 'waiting') {
      parts.push(`<div class="mp-dice${m.dice[0] === m.dice[1] ? ' double' : ''}">${dieHtml(m.dice[0])}${dieHtml(m.dice[1])}</div>`);
    }
    if (animTimer) {
      parts.push('<p class="mp-moving">이동 중…</p>');
    } else {
      if (m.card) parts.push(`<div class="mp-card">🔑 ${esc(m.card.text)}</div>`);
      const mine = myTurn(s);
      if (s.status === 'ended') parts.push(ranking(s));
      else if (mine) parts.push(`<div class="mp-act">${actions(s)}</div>`);
      if (selected !== null && !(mine && (m.phase === 'sell' || m.phase === 'travel'))) parts.push(info(s, selected));
      if (s.status !== 'waiting') parts.push(`<ol class="mp-log">${m.log.slice(-5).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`);
    }
    panel.innerHTML = parts.join('');
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'more' || act === 'less') {
      choice[b.dataset.kind] += act === 'more' ? 1 : -1;
      return renderPanel();
    }
    if (act === 'closeInfo') {
      selected = null;
      return draw();
    }
    if (Date.now() - sentAt < 600) return; // 두 번 눌림 방지
    sentAt = Date.now();
    const data = { type: act };
    if (act === 'build') Object.assign(data, choice);
    if (act === 'sell') data.sq = selected;
    if (act === 'travel') data.to = selected;
    env.emit('act', data);
  });

  return {
    draw,
    reset: sync,
    pointerMove(e) {
      const sq = cellFromEvent(e);
      if (sq !== hover) { hover = sq; draw(); }
    },
    pointerLeave() { hover = null; draw(); },
    pointerUp(e) {
      const sq = cellFromEvent(e);
      const s = env.state;
      if (sq === null || !s || !s.m) return;
      if (myTurn(s) && s.m.phase === 'sell' && s.m.owner[sq] !== s.you.seat) return env.toast('팔 내 땅을 골라 주세요.');
      if (myTurn(s) && s.m.phase === 'travel' && sq === SPACE) return env.toast('우주여행 칸으로는 갈 수 없습니다.');
      selected = selected === sq ? null : sq;
      draw();
    },
  };
};
