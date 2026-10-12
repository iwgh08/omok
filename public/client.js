(() => {
  const { SIZE, EMPTY, BLACK, WHITE } = Renju;
  const CENTER = Math.floor(SIZE / 2);
  const COLOR_NAME = { 1: '흑', 2: '백' };
  const REASON_TEXT = {
    five: '5목 완성',
    timeout: '시간 초과',
    resign: '기권',
    disconnect: '연결 끊김',
    leave: '대국 중 퇴장',
    draw: '판이 가득 참',
  };

  const $ = (id) => document.getElementById(id);
  const socket = io();

  // ---------- 로컬 저장 (실패해도 동작) ----------
  function load(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 무시 */ }
  }
  let clientId = load('omok.clientId');
  if (!clientId) {
    clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    save('omok.clientId', clientId);
  }

  let state = null;
  let currentRoom = null;
  let stateReceivedAt = 0; // 마지막 state를 받은 시각 (내 차례 시계를 화면에서 줄이는 기준)
  let hover = null;       // 마우스 미리보기 위치
  let touchPick = null;   // 터치: 첫 탭으로 선택한 위치
  let forbiddenCache = { key: '', list: [] };
  let autoJoinTried = false;

  // ---------- 로비 ----------
  const nameInput = $('nameInput');
  const codeInput = $('codeInput');
  nameInput.value = load('omok.name') || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) codeInput.value = params.get('room').toUpperCase();

  function getName() {
    const name = nameInput.value.trim();
    if (!name) {
      toast('닉네임을 입력해 주세요.');
      nameInput.focus();
      return null;
    }
    save('omok.name', name);
    return name;
  }

  function onJoined(res) {
    if (!res || !res.ok) return toast(res ? res.error : '입장에 실패했습니다.');
    currentRoom = res.code;
    history.replaceState(null, '', `?room=${res.code}`);
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    $('roomCode').textContent = res.code;
    resizeBoard();
  }

  $('createBtn').onclick = () => {
    const name = getName();
    if (!name) return;
    socket.emit('createRoom', { name, clientId, totalTime: Number($('timeSelect').value) }, onJoined);
  };

  function joinByCode() {
    const name = getName();
    if (!name) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) return toast('방 코드 6자리를 입력해 주세요.');
    socket.emit('joinRoom', { code, name, clientId }, onJoined);
  }
  $('joinBtn').onclick = joinByCode;
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && joinByCode());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (codeInput.value ? joinByCode : () => $('createBtn').click())();
  });

  function backToLobby() {
    currentRoom = null;
    state = null;
    history.replaceState(null, '', location.pathname);
    $('game').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('chatLog').innerHTML = '';
  }

  $('leaveBtn').onclick = () => {
    if (state && state.status === 'playing' && state.you.color &&
        !confirm('대국 중에 나가면 패배 처리됩니다. 나가시겠습니까?')) return;
    socket.emit('leaveRoom');
    backToLobby();
  };

  $('copyBtn').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${currentRoom}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('초대 링크를 복사했습니다. 친구에게 보내 주세요!');
    } catch {
      prompt('아래 링크를 복사해 친구에게 보내 주세요', url);
    }
  };

  // ---------- 소켓 이벤트 ----------
  socket.on('connect', () => {
    // 재접속 시 같은 방으로 자동 복귀
    if (currentRoom) {
      socket.emit('joinRoom', { code: currentRoom, name: load('omok.name') || '익명', clientId }, (res) => {
        if (!res.ok) { toast(res.error); backToLobby(); }
      });
    } else if (!autoJoinTried && params.get('room') && nameInput.value) {
      autoJoinTried = true;
      joinByCode();
    }
  });
  socket.on('disconnect', () => currentRoom && toast('서버 연결이 끊겼습니다. 다시 연결하는 중…'));
  socket.on('errorMsg', (msg) => toast(msg));
  socket.on('kicked', (msg) => { toast(msg); backToLobby(); });
  socket.on('stonePlaced', () => playClick());

  socket.on('state', (s) => {
    const prev = state;
    state = s;
    stateReceivedAt = Date.now();
    touchPick = null;
    render();
    notifyChanges(prev, s);
  });

  socket.on('chatHistory', (list) => {
    $('chatLog').innerHTML = '';
    list.forEach(appendChat);
  });
  socket.on('chat', appendChat);

  // ---------- 채팅 ----------
  function appendChat(msg) {
    const log = $('chatLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const div = document.createElement('div');
    div.className = 'msg' + (msg.system ? ' system' : '');
    if (msg.system) {
      div.textContent = msg.text;
    } else {
      const b = document.createElement('b');
      b.textContent = (msg.color ? (msg.color === BLACK ? '● ' : '○ ') : '👀 ') + msg.name;
      div.append(b, document.createTextNode(msg.text));
    }
    log.appendChild(div);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    $('chatInput').value = '';
  };

  // ---------- 버튼 ----------
  $('undoBtn').onclick = () => socket.emit('undoRequest');
  $('resignBtn').onclick = () => confirm('정말 기권하시겠습니까?') && socket.emit('resign');
  $('rematchBtn').onclick = () => socket.emit('rematch');
  let requestMode = null; // 알림 카드 종류: 'undo' | 'rematch'
  let rematchDismissed = false; // 재대국 카드에서 '나중에'를 눌렀는지
  $('requestYes').onclick = () => {
    if (requestMode === 'undo') socket.emit('undoReply', { accept: true });
    if (requestMode === 'rematch') socket.emit('rematch');
  };
  $('requestNo').onclick = () => {
    if (requestMode === 'undo') socket.emit('undoReply', { accept: false });
    if (requestMode === 'rematch') { rematchDismissed = true; render(); }
  };
  for (const id of ['numToggle', 'forbidToggle']) $(id).onchange = drawBoard;
  $('soundToggle').checked = load('omok.sound') !== 'off';
  $('soundToggle').onchange = () => save('omok.sound', $('soundToggle').checked ? 'on' : 'off');

  // ---------- 화면 갱신 ----------
  function playerName(color) {
    const seat = state.seats.find((s) => s && s.color === color);
    return seat ? seat.name : COLOR_NAME[color];
  }

  function render() {
    if (!state) return;
    const s = state;
    const me = s.you;
    $('timeLimitLabel').textContent = `각자 ${s.totalTime / 60}분`;

    // 상태 문구
    const bar = $('statusBar');
    let text = '';
    let myTurn = false;
    if (s.status === 'waiting') {
      text = '상대를 기다리는 중… "초대 링크 복사"로 친구를 불러 주세요';
    } else if (s.status === 'playing') {
      myTurn = me.color === s.turn;
      if (myTurn) text = `내 차례입니다 (${COLOR_NAME[s.turn]})`;
      else text = `${playerName(s.turn)} (${COLOR_NAME[s.turn]}) 차례`;
      if (s.moves.length === 0) text += ' · 첫 수는 정중앙에';
      if (!me.color) text = '관전 중 · ' + text;
    } else if (s.status === 'ended') {
      if (s.winner) {
        const who = me.color ? (s.winner === me.color ? '승리했습니다!' : '패배했습니다') :
          `${playerName(s.winner)} (${COLOR_NAME[s.winner]}) 승리`;
        text = `${who} — ${REASON_TEXT[s.reason]}`;
      } else {
        text = `무승부 — ${REASON_TEXT[s.reason]}`;
      }
      if (me.seat >= 0 && s.rematch.length === 1 && !s.rematch.includes(me.seat)) text += ' · 상대가 재대국을 원합니다';
    }
    bar.textContent = myTurn ? `● ${text}` : text;
    bar.classList.toggle('my-turn', myTurn);
    $('boardStage').classList.toggle('my-turn', myTurn);

    // 플레이어 카드 (흑이 위)
    const order = [0, 1];
    if (s.seats[1] && s.seats[1].color === BLACK) order.reverse();
    order.forEach((seatIdx, slot) => renderPlayer($(`player${slot}`), s.seats[seatIdx], seatIdx === me.seat));

    // 상대의 요청 알림 카드
    const opponentSeat = me.seat >= 0 ? 1 - me.seat : -1;
    if (s.status === 'playing' && s.undoRequest && me.color && me.color !== s.undoRequest) {
      requestMode = 'undo';
      $('requestText').textContent = `${playerName(s.undoRequest)} 님이 무르기를 요청했습니다`;
      $('requestYes').textContent = '수락';
      $('requestNo').textContent = '거절';
    } else if (s.status === 'ended' && opponentSeat >= 0 && s.rematch.includes(opponentSeat) &&
               !s.rematch.includes(me.seat) && !rematchDismissed) {
      requestMode = 'rematch';
      $('requestText').textContent = `${s.seats[opponentSeat].name} 님이 재대국을 원합니다 (흑백 교대)`;
      $('requestYes').textContent = '재대국 하기';
      $('requestNo').textContent = '나중에';
    } else {
      requestMode = null;
    }
    $('requestCard').classList.toggle('hidden', !requestMode);

    // 버튼
    const playing = s.status === 'playing' && !!me.color;
    $('undoBtn').disabled = !playing || !!s.undoRequest;
    $('undoBtn').textContent = s.undoRequest === me.color && me.color ? '무르기 요청 중…' : '무르기';
    $('resignBtn').disabled = !playing;
    const canRematch = s.status === 'ended' && me.seat >= 0;
    $('rematchBtn').classList.toggle('hidden', !canRematch);
    $('undoBtn').classList.toggle('hidden', canRematch);
    $('resignBtn').classList.toggle('hidden', canRematch);
    const waitingRematch = s.rematch.includes(me.seat);
    $('rematchBtn').disabled = waitingRematch;
    $('rematchBtn').textContent = waitingRematch ? '상대 대기 중…' : '재대국 (흑백 교대)';

    $('spectators').textContent = s.spectators.length ? `관전자 ${s.spectators.length}명: ${s.spectators.join(', ')}` : '';

    updateTimers();
    drawBoard();
  }

  function renderPlayer(el, seat, isMe) {
    el.innerHTML = '';
    el.classList.toggle('active', !!(seat && state.status === 'playing' && seat.color === state.turn));
    const stone = document.createElement('span');
    stone.className = `stone c${seat ? seat.color : 0}`;
    const name = document.createElement('span');
    name.className = 'name';
    if (seat) {
      name.textContent = seat.name;
      if (isMe) {
        const tag = document.createElement('span');
        tag.className = 'me';
        tag.textContent = '(나)';
        name.appendChild(tag);
      }
    } else {
      name.textContent = '빈 자리';
      name.style.color = 'var(--muted)';
    }
    el.append(stone, name);
    if (seat) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (seat.connected ? '' : ' off');
      dot.title = seat.connected ? '접속 중' : '연결 끊김';
      el.appendChild(dot);
      const time = document.createElement('span');
      time.className = 'time';
      time.dataset.color = seat.color;
      el.appendChild(time);
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.dataset.color = seat.color;
      el.appendChild(bar);
    }
  }

  // 남은 시간: 서버가 보낸 값에서, 지금 차례인 쪽만 받은 뒤 흐른 시간을 뺌
  function clockOf(color) {
    const base = state.clocks[color];
    const running = state.status === 'playing' && color === state.turn;
    return Math.max(0, base - (running ? Date.now() - stateReceivedAt : 0));
  }

  function formatClock(ms) {
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function updateTimers() {
    if (!state) return;
    const started = state.status !== 'waiting' || state.moves.length > 0;
    document.querySelectorAll('.player .time').forEach((el) => {
      const color = Number(el.dataset.color);
      const ms = color && started ? clockOf(color) : state.totalTime * 1000;
      el.textContent = formatClock(ms);
      el.classList.toggle('low', state.status === 'playing' && color === state.turn && ms <= 30000);
    });
    document.querySelectorAll('.player .bar').forEach((el) => {
      const color = Number(el.dataset.color);
      const ms = color && started ? clockOf(color) : state.totalTime * 1000;
      el.style.width = `${(ms / (state.totalTime * 1000)) * 100}%`;
      el.style.opacity = state.status === 'playing' && color === state.turn ? '1' : '0.35';
    });
  }
  setInterval(updateTimers, 100);

  // ---------- 바둑판 ----------
  const canvas = $('board');
  const ctx = canvas.getContext('2d');

  function resizeBoard() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    if (!w) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    drawBoard();
  }
  new ResizeObserver(resizeBoard).observe(canvas);

  function geometry() {
    const w = canvas.width;
    const cell = w / (SIZE + 1);
    return { w, cell, pos: (i) => cell + i * cell };
  }

  function forbiddenPoints() {
    if (!state || state.status !== 'playing' || state.turn !== BLACK || state.moves.length === 0) return [];
    const key = state.moves.map((m) => m.join(',')).join(';');
    if (forbiddenCache.key !== key) {
      forbiddenCache = { key, list: Renju.allForbidden(state.board.slice()) };
    }
    return forbiddenCache.list;
  }

  function winningLine() {
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

  function drawBoard() {
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
    const s = state;
    const say = (m) => { if (explain) toast(m); return false; };
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

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const p = pointFromEvent(e);
    if (p?.x !== hover?.x || p?.y !== hover?.y) { hover = p; drawBoard(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; drawBoard(); });

  canvas.addEventListener('pointerup', (e) => {
    const p = pointFromEvent(e);
    if (!p || !canPlace(p.x, p.y, true)) return;
    // 터치는 실수 방지를 위해 같은 자리를 두 번 탭해야 착수
    if (e.pointerType !== 'mouse' && !(touchPick && touchPick.x === p.x && touchPick.y === p.y)) {
      touchPick = p;
      drawBoard();
      return;
    }
    touchPick = null;
    hover = null;
    socket.emit('place', p);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawBoard);

  // ---------- 효과음 / 알림 ----------
  let audioCtx = null;
  function playClick() {
    if (!$('soundToggle').checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.exponentialRampToValueAtTime(250, t + 0.06);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch { /* 소리 미지원 */ }
  }

  // ---------- 상태 변화 알림 (내 차례, 상대 요청 등) ----------
  function notifyChanges(prev, s) {
    const me = s.you;
    if (!me.color && me.seat < 0) return; // 관전자는 알림 없음
    const opponentSeat = me.seat >= 0 ? 1 - me.seat : -1;
    const wasPlaying = prev && prev.code === s.code && prev.status === 'playing';

    // 새 대국 시작
    if (s.status === 'playing' && !wasPlaying) {
      rematchDismissed = false;
      showBadge(`대국 시작! 나는 ${COLOR_NAME[me.color]}`, 1600);
      chime();
      attention('대국 시작!');
      return;
    }

    // 대국 종료
    if (s.status === 'ended' && wasPlaying) {
      showBadge(!s.winner ? '무승부' : s.winner === me.color ? '승리! 🎉' : '패배', 1800);
      attention(!s.winner ? '무승부' : s.winner === me.color ? '승리!' : '패배');
    }

    if (s.status === 'playing' && wasPlaying) {
      // 내 차례가 됨
      const moved = prev.turn !== s.turn || prev.moves.length !== s.moves.length;
      if (me.color === s.turn && moved) {
        showBadge('내 차례!');
        if (document.hidden) chime();
        attention('내 차례입니다');
      }
      // 상대가 무르기 요청
      if (s.undoRequest && s.undoRequest !== me.color && prev.undoRequest !== s.undoRequest) {
        chime();
        attention('무르기 요청');
      }
      // 내 무르기 요청의 결과
      if (prev.undoRequest === me.color && !s.undoRequest) {
        if (s.moves.length < prev.moves.length) toast('무르기가 수락되었습니다');
        else if (s.moves.length > prev.moves.length) toast('상대가 무르기 대신 수를 두었습니다');
        else toast('상대가 무르기를 거절했습니다');
      }
    }

    // 상대가 재대국 요청
    if (s.status === 'ended' && opponentSeat >= 0 && s.rematch.includes(opponentSeat) &&
        !(prev && prev.rematch.includes(opponentSeat))) {
      rematchDismissed = false;
      render();
      chime();
      attention('재대국 요청');
    }
  }

  let badgeTimer = null;
  function showBadge(text, ms = 1100) {
    const el = $('turnBadge');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // 다른 탭을 보고 있을 때 브라우저 탭 제목을 깜빡여 알림
  const baseTitle = document.title;
  let titleTimer = null;
  function attention(text) {
    if (!document.hidden) return;
    clearInterval(titleTimer);
    let on = false;
    titleTimer = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 ${text}` : baseTitle;
    }, 900);
    document.title = `🔔 ${text}`;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    clearInterval(titleTimer);
    document.title = baseTitle;
  });

  // 알림음: 부드러운 '띵동'
  function chime() {
    if (!$('soundToggle').checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [[880, 0], [1320, 0.13]].forEach(([freq, delay]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.2, t + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.4);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + delay);
        osc.stop(t + delay + 0.45);
      });
    } catch { /* 소리 미지원 */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
})();
