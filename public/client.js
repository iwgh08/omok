(() => {
  const { BLACK } = Renju;
  const COLOR_NAME = { 1: '흑', 2: '백' };
  const Q_COLORS = window.QUORIDOR_COLORS;
  const Q_NAMES = window.QUORIDOR_COLOR_NAMES;
  const REASON_TEXT = {
    five: '5목 완성',
    goal: '목표 도달',
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
  let autoJoinTried = false;

  // ---------- 로비 ----------
  const nameInput = $('nameInput');
  const codeInput = $('codeInput');
  nameInput.value = load('omok.name') || '';
  const params = new URLSearchParams(location.search);
  if (params.get('room')) codeInput.value = params.get('room').toUpperCase();

  const gameSelect = $('gameSelect');
  const playersSelect = $('playersSelect');
  gameSelect.value = load('omok.game') === 'quoridor' ? 'quoridor' : 'omok';
  playersSelect.value = ['2', '3', '4'].includes(load('omok.players')) ? load('omok.players') : '2';
  const syncGameSelect = () => playersSelect.classList.toggle('hidden', gameSelect.value !== 'quoridor');
  gameSelect.onchange = () => { save('omok.game', gameSelect.value); syncGameSelect(); };
  playersSelect.onchange = () => save('omok.players', playersSelect.value);
  syncGameSelect();

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
    socket.emit('createRoom', {
      name, clientId,
      totalTime: Number($('timeSelect').value),
      game: gameSelect.value,
      players: Number(playersSelect.value),
    }, onJoined);
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
    if (state && amPlaying() &&
        !confirm(`대국 중에 나가면 ${isQ() ? '탈락' : '패배'} 처리됩니다. 나가시겠습니까?`)) return;
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
    board().reset();
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
      if (msg.seat !== undefined) {
        // 쿼리도: 말 색 점
        const dot = document.createElement('span');
        dot.textContent = msg.seat >= 0 ? '● ' : '👀 ';
        if (msg.seat >= 0) dot.style.color = Q_COLORS[msg.seat];
        b.append(dot, msg.name);
      } else {
        b.textContent = (msg.color ? (msg.color === BLACK ? '● ' : '○ ') : '👀 ') + msg.name;
      }
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

  // ---------- 게임별 공통 판단 ----------
  // 오목은 색(1|2)으로, 쿼리도는 자리 번호로 차례·시계·승자를 구분한다
  const isQ = () => state.game === 'quoridor';
  const myKey = () => (isQ() ? state.you.seat : state.you.color);
  // 지금 대국에 참여 중인지 (쿼리도는 탈락하지 않았는지)
  function amPlaying() {
    const s = state;
    if (s.status !== 'playing' || s.you.seat < 0) return false;
    return isQ() ? !!s.q.pawns[s.you.seat] : !!s.you.color;
  }
  const moveCount = (s) => (s.game === 'quoridor' ? s.moveCount : s.moves.length);

  function playerName(color) {
    const seat = state.seats.find((s) => s && s.color === color);
    return seat ? seat.name : COLOR_NAME[color];
  }
  const qName = (p) => state.names[p] || state.seats[p]?.name || Q_NAMES[p];

  // ---------- 화면 갱신 ----------
  function omokStatus(s) {
    const me = s.you;
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
    return { text, myTurn };
  }

  function quoridorStatus(s) {
    const seat = s.you.seat;
    let text = '';
    let myTurn = false;
    if (s.status === 'waiting') {
      const filled = s.seats.filter(Boolean).length;
      text = `참가자를 기다리는 중… (${filled}/${s.players}명) "초대 링크 복사"로 친구를 불러 주세요`;
      if (s.winner !== null) text = `지난 대국 ${qName(s.winner)} 승리 · ${text}`;
    } else if (s.status === 'playing') {
      const alive = seat >= 0 && !!s.q.pawns[seat];
      myTurn = alive && s.turn === seat;
      text = myTurn ? `내 차례입니다 (${Q_NAMES[seat]}) · 말을 움직이거나 벽을 놓으세요`
        : `${qName(s.turn)} (${Q_NAMES[s.turn]}) 차례`;
      if (seat < 0) text = '관전 중 · ' + text;
      else if (!alive) text = '탈락 · ' + text;
    } else if (s.status === 'ended') {
      const who = seat >= 0 ? (s.winner === seat ? '승리했습니다!' : `패배했습니다 · ${qName(s.winner)} 승리`)
        : `${qName(s.winner)} (${Q_NAMES[s.winner]}) 승리`;
      text = `${who} — ${REASON_TEXT[s.reason]}`;
      if (seat >= 0 && s.rematch.length && !s.rematch.includes(seat)) text += ` · 재대국 요청 ${s.rematch.length}/${s.players}`;
    }
    return { text, myTurn };
  }

  function render() {
    if (!state) return;
    const s = state;
    const me = s.you;
    document.body.dataset.game = s.game;
    $('timeLimitLabel').textContent = `${isQ() ? `쿼리도 ${s.players}인 · ` : ''}각자 ${s.totalTime / 60}분`;

    // 상태 문구
    const bar = $('statusBar');
    const { text, myTurn } = isQ() ? quoridorStatus(s) : omokStatus(s);
    bar.textContent = myTurn ? `● ${text}` : text;
    bar.classList.toggle('my-turn', myTurn);
    $('boardStage').classList.toggle('my-turn', myTurn);

    renderPlayers();

    // 다른 대국자의 요청 알림 카드
    if (s.status === 'playing' && s.undoRequest !== null && amPlaying() && myKey() !== s.undoRequest &&
        !(isQ() && s.undoAccepts.includes(me.seat))) {
      requestMode = 'undo';
      if (isQ()) {
        const need = s.q.pawns.filter(Boolean).length - 1;
        $('requestText').textContent = `${qName(s.undoRequest)} 님이 무르기를 요청했습니다 (수락 ${s.undoAccepts.length}/${need})`;
      } else {
        $('requestText').textContent = `${playerName(s.undoRequest)} 님이 무르기를 요청했습니다`;
      }
      $('requestYes').textContent = '수락';
      $('requestNo').textContent = '거절';
    } else if (s.status === 'ended' && me.seat >= 0 && s.rematch.length && !s.rematch.includes(me.seat) &&
               !rematchDismissed) {
      requestMode = 'rematch';
      const names = s.rematch.map((i) => s.seats[i]?.name).filter(Boolean).join(', ');
      $('requestText').textContent = isQ()
        ? `${names} 님이 재대국을 원합니다 (${s.rematch.length}/${s.players}, 차례 순서 교대)`
        : `${names} 님이 재대국을 원합니다 (흑백 교대)`;
      $('requestYes').textContent = '재대국 하기';
      $('requestNo').textContent = '나중에';
    } else {
      requestMode = null;
    }
    $('requestCard').classList.toggle('hidden', !requestMode);

    // 버튼
    const playing = amPlaying();
    const requesting = playing && s.undoRequest === myKey();
    $('undoBtn').disabled = !playing || s.undoRequest !== null;
    $('undoBtn').textContent = requesting ? '무르기 요청 중…' : '무르기';
    $('resignBtn').disabled = !playing;
    const canRematch = s.status === 'ended' && me.seat >= 0;
    $('rematchBtn').classList.toggle('hidden', !canRematch);
    $('undoBtn').classList.toggle('hidden', canRematch);
    $('resignBtn').classList.toggle('hidden', canRematch);
    const waitingRematch = s.rematch.includes(me.seat);
    $('rematchBtn').disabled = waitingRematch;
    if (isQ()) {
      $('rematchBtn').textContent = waitingRematch ? `다른 사람 대기 중… (${s.rematch.length}/${s.players})` : '재대국 (순서 교대)';
    } else {
      $('rematchBtn').textContent = waitingRematch ? '상대 대기 중…' : '재대국 (흑백 교대)';
    }

    $('spectators').textContent = s.spectators.length ? `관전자 ${s.spectators.length}명: ${s.spectators.join(', ')}` : '';

    updateTimers();
    drawBoard();
  }

  // 플레이어 카드: 오목은 흑이 위, 쿼리도는 차례 순서대로
  function renderPlayers() {
    const s = state;
    const cards = [];
    if (isQ()) {
      for (const p of Quoridor.turnOrder(s.players)) {
        const seat = s.seats[p];
        const started = s.status !== 'waiting';
        cards.push({
          name: seat ? seat.name : started ? qName(p) : null,
          isMe: p === s.you.seat,
          connected: seat ? seat.connected : null,
          active: s.status === 'playing' && s.turn === p,
          out: started && !s.q.pawns[p],
          stoneColor: Q_COLORS[p],
          clockKey: seat || started ? p : null,
          extra: `벽 ${started ? s.q.wallsLeft[p] : Quoridor.WALLS[s.players]}`,
        });
      }
    } else {
      const order = [0, 1];
      if (s.seats[1] && s.seats[1].color === BLACK) order.reverse();
      for (const i of order) {
        const seat = s.seats[i];
        cards.push({
          name: seat ? seat.name : null,
          isMe: i === s.you.seat,
          connected: seat ? seat.connected : null,
          active: !!(seat && s.status === 'playing' && seat.color === s.turn),
          stoneClass: `c${seat ? seat.color : 0}`,
          clockKey: seat ? seat.color : null,
        });
      }
    }
    const box = $('players');
    while (box.children.length < cards.length) box.appendChild(Object.assign(document.createElement('div'), { className: 'player' }));
    while (box.children.length > cards.length) box.lastChild.remove();
    cards.forEach((c, i) => renderPlayer(box.children[i], c));
  }

  function renderPlayer(el, c) {
    el.innerHTML = '';
    el.classList.toggle('active', c.active);
    el.classList.toggle('out', !!c.out);
    const stone = document.createElement('span');
    stone.className = `stone ${c.stoneClass || ''}`;
    if (c.stoneColor) stone.style.background = c.stoneColor;
    const name = document.createElement('span');
    name.className = 'name';
    if (c.name) {
      name.textContent = c.name;
      const tags = [];
      if (c.isMe) tags.push('(나)');
      if (c.out) tags.push('탈락');
      if (tags.length) {
        const tag = document.createElement('span');
        tag.className = 'me';
        tag.textContent = tags.join(' ');
        name.appendChild(tag);
      }
    } else {
      name.textContent = '빈 자리';
      name.style.color = 'var(--muted)';
    }
    el.append(stone, name);
    if (c.extra) {
      const extra = document.createElement('span');
      extra.className = 'extra';
      extra.textContent = c.extra;
      el.appendChild(extra);
    }
    if (c.connected !== null) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (c.connected ? '' : ' off');
      dot.title = c.connected ? '접속 중' : '연결 끊김';
      el.appendChild(dot);
    }
    if (c.clockKey !== null) {
      const time = document.createElement('span');
      time.className = 'time';
      time.dataset.key = c.clockKey;
      el.appendChild(time);
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.dataset.key = c.clockKey;
      el.appendChild(bar);
    }
  }

  // 남은 시간: 서버가 보낸 값에서, 지금 차례인 쪽만 받은 뒤 흐른 시간을 뺌
  function clockOf(key) {
    const base = state.clocks[key];
    const running = state.status === 'playing' && key === state.turn;
    return Math.max(0, base - (running ? Date.now() - stateReceivedAt : 0));
  }

  function formatClock(ms) {
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function updateTimers() {
    if (!state) return;
    const started = state.status !== 'waiting' || moveCount(state) > 0;
    const total = state.totalTime * 1000;
    document.querySelectorAll('.player .time').forEach((el) => {
      const key = Number(el.dataset.key);
      const ms = started ? clockOf(key) : total;
      el.textContent = formatClock(ms);
      el.classList.toggle('low', state.status === 'playing' && key === state.turn && ms <= 30000);
    });
    document.querySelectorAll('.player .bar').forEach((el) => {
      const key = Number(el.dataset.key);
      const ms = started ? clockOf(key) : total;
      el.style.width = `${(ms / total) * 100}%`;
      el.style.opacity = state.status === 'playing' && key === state.turn ? '1' : '0.35';
    });
  }
  setInterval(updateTimers, 100);

  // ---------- 판 (그리기와 입력은 게임별 모듈) ----------
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  const env = {
    canvas, ctx, $, toast,
    get state() { return state; },
    emit: (ev, data) => socket.emit(ev, data),
  };
  const boards = { omok: OmokBoard(env), quoridor: QuoridorBoard(env) };
  const board = () => boards[state ? state.game : 'omok'];
  function drawBoard() { board().draw(); }

  function resizeBoard() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    if (!w) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    drawBoard();
  }
  new ResizeObserver(resizeBoard).observe(canvas);

  canvas.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && board().pointerMove(e));
  canvas.addEventListener('pointerleave', () => board().pointerLeave());
  canvas.addEventListener('pointerup', (e) => board().pointerUp(e));
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

  // ---------- 상태 변화 표시 (내 차례, 다른 사람 요청 등) ----------
  function notifyChanges(prev, s) {
    const me = s.you;
    if (me.seat < 0) return; // 관전자는 표시 없음
    const q = s.game === 'quoridor';
    const key = q ? me.seat : me.color;
    const wasPlaying = prev && prev.code === s.code && prev.status === 'playing';

    // 새 대국 시작
    if (s.status === 'playing' && !wasPlaying) {
      rematchDismissed = false;
      showBadge(`대국 시작! 나는 ${q ? Q_NAMES[me.seat] : COLOR_NAME[me.color]}`, 1600);
      return;
    }

    // 대국 종료
    if (s.status === 'ended' && wasPlaying) {
      showBadge(!q && !s.winner ? '무승부' : s.winner === key ? '승리! 🎉' : '패배', 1800);
    }

    if (s.status === 'playing' && wasPlaying) {
      const alive = !q || !!s.q.pawns[me.seat];
      // 탈락
      if (q && !alive && prev.q.pawns[me.seat]) showBadge('탈락', 1600);
      // 내 차례가 됨
      const moved = prev.turn !== s.turn || moveCount(prev) !== moveCount(s);
      if (alive && key === s.turn && moved) showBadge('내 차례!');
      // 내 무르기 요청의 결과 (누가 탈락해서 취소된 경우는 제외)
      const outChanged = q && s.q.pawns.filter(Boolean).length !== prev.q.pawns.filter(Boolean).length;
      if (prev.undoRequest === key && s.undoRequest === null && !outChanged) {
        if (moveCount(s) < moveCount(prev)) toast('무르기가 수락되었습니다');
        else if (moveCount(s) > moveCount(prev)) toast(q ? '다른 사람이 무르기 대신 수를 두었습니다' : '상대가 무르기 대신 수를 두었습니다');
        else toast(q ? '무르기가 거절되었습니다' : '상대가 무르기를 거절했습니다');
      }
    }

    // 다른 대국자가 재대국 요청
    if (s.status === 'ended' && s.rematch.some((i) => i !== me.seat && !(prev && prev.rematch.includes(i)))) {
      rematchDismissed = false;
      render();
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

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
})();
