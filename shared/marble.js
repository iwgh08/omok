// 부루마블 규칙과 차례 진행 (서버/브라우저 공용)
// 판: 40칸, 0번 출발에서 시작해 번호가 커지는 쪽으로 돈다. 금액은 원 단위 정수
// 주사위 값(ctx.dice)과 난수 함수(ctx.rand)는 밖에서 넣는다 (테스트에서 결과를 고정하려고)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Marble = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 40;
  const START_CASH = 3000000;
  const SALARY = 200000;     // 출발을 지나거나 도착하면 받는 월급
  const FUND_PAY = 150000;   // 사회복지기금 접수처에서 내는 돈
  const SPACE_FEE = 200000;  // 우주여행 탑승료 (컬럼비아호 주인에게)
  const ISLAND = 10, FUND_GET = 20, SPACE = 30, COLUMBIA = 32;
  const ISLAND_TURNS = 3;    // 무인도에서 쉬는 턴 수 (더블이 나오면 바로 탈출)
  const LOG_SIZE = 8;
  const KINDS = ['villa', 'building', 'hotel'];
  const KIND_NAMES = { villa: '별장', building: '빌딩', hotel: '호텔' };
  const MAX = { villa: 2, building: 1, hotel: 1 };
  // 판의 줄(0~3)마다 건물 한 채 값
  const BUILD_COST = [
    { villa: 50000, building: 150000, hotel: 250000 },
    { villa: 100000, building: 300000, hotel: 500000 },
    { villa: 150000, building: 450000, hotel: 750000 },
    { villa: 200000, building: 600000, hotel: 1000000 },
  ];
  // 도시 통행료 = 땅값×land + 건물값×건물별 비율 (관광지는 칸마다 고정)
  const TOLL_RATE = { land: 0.2, villa: 0.6, building: 1.0, hotel: 1.4 };

  const city = (name, group, price, short) => ({ type: 'city', name, short: short || name, group, price });
  const tour = (name, price, toll, short) => ({ type: 'tour', name, short: short || name, price, toll });
  const key = () => ({ type: 'key', name: '황금열쇠', short: '황금열쇠' });
  const BOARD = [
    { type: 'start', name: '출발', short: '출발' },
    city('타이베이', 0, 50000),
    key(),
    city('베이징', 0, 80000),
    city('마닐라', 0, 80000),
    tour('제주도', 200000, 300000),
    city('싱가포르', 1, 100000),
    key(),
    city('카이로', 1, 100000),
    city('이스탄불', 1, 120000),
    { type: 'island', name: '무인도', short: '무인도' },
    city('아테네', 2, 140000),
    key(),
    city('코펜하겐', 2, 160000),
    city('스톡홀름', 2, 160000),
    tour('콩코드 여객기', 200000, 300000, '콩코드'),
    city('취리히', 3, 180000),
    key(),
    city('베를린', 3, 180000),
    city('몬트리올', 3, 200000),
    { type: 'fundGet', name: '사회복지기금 수령처', short: '기금 받기' },
    city('부에노스아이레스', 4, 220000, '부에노스'),
    key(),
    city('상파울루', 4, 240000),
    city('시드니', 4, 240000),
    tour('부산', 500000, 600000),
    city('하와이', 5, 260000),
    city('리스본', 5, 260000),
    tour('퀸엘리자베스호', 300000, 350000, '엘리자베스'),
    city('마드리드', 5, 280000),
    { type: 'space', name: '우주여행', short: '우주여행' },
    city('도쿄', 6, 300000),
    tour('컬럼비아호', 450000, 500000, '컬럼비아'),
    city('파리', 6, 320000),
    city('로마', 6, 320000),
    key(),
    city('런던', 7, 350000),
    city('뉴욕', 7, 350000),
    { type: 'fundPay', name: '사회복지기금 접수처', short: '기금 내기' },
    tour('서울', 1000000, 2000000),
  ];

  // 황금열쇠 카드
  const CARDS = [
    { text: '복권 당첨! 20만 원을 받습니다.', money: 200000 },
    { text: '노벨 평화상 수상! 30만 원을 받습니다.', money: 300000 },
    { text: '장학금 10만 원을 받습니다.', money: 100000 },
    { text: '연금 혜택으로 5만 원을 받습니다.', money: 50000 },
    { text: '병원비 5만 원을 냅니다.', money: -50000 },
    { text: '과속 벌금 5만 원을 냅니다.', money: -50000 },
    { text: '해외 유학비 10만 원을 냅니다.', money: -100000 },
    { text: '사회복지기금 15만 원을 냅니다.', fund: 150000 },
    { text: '건물 수리비: 별장 3만, 빌딩 10만, 호텔 15만 원씩 냅니다.', perBuilding: { villa: 30000, building: 100000, hotel: 150000 } },
    { text: '방범비: 별장 5만, 빌딩 15만, 호텔 25만 원씩 냅니다.', perBuilding: { villa: 50000, building: 150000, hotel: 250000 } },
    { text: '생일 축하! 모두에게 5만 원씩 받습니다.', fromEach: 50000 },
    { text: '고속도로: 출발로 가서 월급을 받습니다.', moveTo: 0 },
    { text: '제주도 관광 여행을 떠납니다.', moveTo: 5 },
    { text: '부산 관광 여행을 떠납니다.', moveTo: 25 },
    { text: '서울로 초대받았습니다.', moveTo: 39 },
    { text: '우주여행 초청장: 우주여행 칸으로 갑니다.', moveTo: SPACE },
    { text: '사회복지기금을 받으러 갑니다.', moveTo: FUND_GET },
    { text: '폭풍을 만나 무인도에 갇혔습니다.', island: true },
    { text: '이사: 앞으로 3칸 갑니다.', moveBy: 3 },
    { text: '뒤로 2칸 갑니다.', moveBy: -2 },
    { text: '뒤로 3칸 갑니다.', moveBy: -3 },
    { text: '무인도 탈출권: 보관했다가 무인도에서 바로 나옵니다.', escape: true },
    { text: '우대권: 보관했다가 통행료를 한 번 면제받습니다.', waiver: true },
    { text: '반액 대매출: 가장 비싼 땅을 은행에 반값에 팝니다.', sale: true },
  ];

  // 행동마다 할 수 있는 단계
  const ALLOWED = {
    roll: ['roll', 'travel'], // 우주여행 칸에서는 여행 대신 그냥 굴릴 수도 있음
    buy: ['buy'],
    skip: ['buy', 'build'],
    build: ['build'],
    sell: ['sell'],
    autoSell: ['sell'],
    travel: ['travel'],
  };

  const row = (sq) => Math.floor(sq / 10);
  const die = (rand) => 1 + Math.floor(rand() * 6);
  const isProperty = (sq) => BOARD[sq].type === 'city' || BOARD[sq].type === 'tour';

  function shuffle(list, rand) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function money(n) {
    return `${(Math.round(n / 1000) / 10).toLocaleString('ko-KR')}만`;
  }

  function turnOrder(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  function createGame(n, opts) {
    const o = opts || {};
    const rand = o.rand || Math.random;
    const first = o.first || 0;
    return {
      n,
      first,       // 첫 차례 자리 (이 자리로 돌아올 때 턴 수가 늘어남)
      turn: first,
      phase: 'roll', // 'roll' | 'buy' | 'build' | 'sell' | 'travel'
      round: 1,
      maxRounds: o.maxRounds || 20,
      names: o.names || [],
      players: Array.from({ length: n }, () => ({
        pos: 0, cash: START_CASH, out: false, island: 0, doubles: 0, escape: 0, waiver: 0, travel: false,
      })),
      owner: Array(SIZE).fill(null),
      buildings: Array.from({ length: SIZE }, () => ({ villa: 0, building: 0, hotel: 0 })),
      fund: 0,
      dice: null,
      again: false,   // 더블이라 이 차례가 끝나면 한 번 더 굴림
      pending: null,  // sell 단계에서 갚아야 할 빚 {debt, creditor: 자리 번호 | 'fund' | null(은행)}
      card: null,     // 방금 뽑은 황금열쇠 {p, text}
      path: [],       // 방금 행동으로 움직인 경로 [{p, from, to, walk}] (화면 애니메이션용)
      log: [],
      seq: 0,         // 행동이 반영될 때마다 1씩 늘어남
      deck: shuffle(CARDS.map((_, i) => i), rand), // 숨겨야 하는 정보: publicView에서 뺌
      over: null,     // {winner, reason: 'bankrupt' | 'rounds'}
    };
  }

  function publicView(g) {
    const { deck, ...view } = g;
    return view;
  }

  const name = (g, p) => g.names[p] || `${p + 1}번`;

  function log(g, text) {
    g.log.push(text);
    if (g.log.length > LOG_SIZE) g.log.shift();
  }

  // 새 행동을 시작할 때 지난 행동의 표시 정보를 지움
  function fresh(g) {
    g.seq++;
    g.path = [];
    g.card = null;
  }

  function aliveSeats(g) {
    return turnOrder(g.n).filter((p) => !g.players[p].out);
  }

  function nextAlive(g, from) {
    for (let k = 1; k <= g.n; k++) {
      const p = (from + k) % g.n;
      if (!g.players[p].out) return p;
    }
    return from;
  }

  function owned(g, p) {
    return g.owner.map((o, sq) => (o === p ? sq : -1)).filter((sq) => sq >= 0);
  }

  function buildingValue(g, sq) {
    const b = g.buildings[sq], cost = BUILD_COST[row(sq)];
    return KINDS.reduce((sum, k) => sum + b[k] * cost[k], 0);
  }

  // 은행에 팔 때 받는 돈: 땅값과 건물값의 절반
  function sellValue(g, sq) {
    return Math.floor((BOARD[sq].price + buildingValue(g, sq)) / 2);
  }

  function assets(g, p) {
    return g.players[p].cash + owned(g, p).reduce((sum, sq) => sum + BOARD[sq].price + buildingValue(g, sq), 0);
  }

  function toll(g, sq) {
    const cell = BOARD[sq];
    if (cell.type === 'tour') return cell.toll;
    const b = g.buildings[sq], cost = BUILD_COST[row(sq)];
    const t = cell.price * TOLL_RATE.land + KINDS.reduce((sum, k) => sum + b[k] * cost[k] * TOLL_RATE[k], 0);
    return Math.round(t / 1000) * 1000;
  }

  // 지금 가진 돈으로 지을 수 있는 건물이 하나라도 있는지
  function canBuild(g, sq, cash) {
    if (BOARD[sq].type !== 'city') return false;
    const b = g.buildings[sq], cost = BUILD_COST[row(sq)];
    return KINDS.some((k) => b[k] < MAX[k] && cost[k] <= cash);
  }

  function release(g, sq) {
    g.owner[sq] = null;
    g.buildings[sq] = { villa: 0, building: 0, hotel: 0 };
  }

  function give(g, to, amount) {
    if (typeof to === 'number') g.players[to].cash += amount;
    else if (to === 'fund') g.fund += amount;
  }

  // 돈이 모자랄 때 싼 땅부터 팔아 amount를 마련
  function autoSell(g, p, amount) {
    const me = g.players[p];
    const list = owned(g, p).sort((a, b) => sellValue(g, a) - sellValue(g, b));
    for (const sq of list) {
      if (me.cash >= amount) break;
      const v = sellValue(g, sq);
      me.cash += v;
      release(g, sq);
      log(g, `${name(g, p)}: ${BOARD[sq].name} 매각 (+${money(v)})`);
    }
  }

  // p가 amount를 to(자리 번호 | 'fund' | null=은행)에게 낸다. 바로 냈으면 true
  // 차례인 사람은 sell 단계로 넘어가 팔 땅을 직접 고르고, 다른 사람은 자동으로 판다
  function charge(g, p, amount, to) {
    const me = g.players[p];
    if (me.cash >= amount) {
      me.cash -= amount;
      give(g, to, amount);
      return true;
    }
    const total = me.cash + owned(g, p).reduce((sum, sq) => sum + sellValue(g, sq), 0);
    if (total < amount) {
      bankrupt(g, p, amount, to);
      return false;
    }
    if (p === g.turn) {
      g.phase = 'sell';
      g.pending = { debt: amount, creditor: to };
      log(g, `${name(g, p)}: 돈이 모자랍니다. 땅을 팔아 ${money(amount)}을 마련하세요`);
      return false;
    }
    autoSell(g, p, amount);
    me.cash -= amount;
    give(g, to, amount);
    return true;
  }

  // 땅을 모두 팔아도 못 갚으면 가진 것을 전부 내고 탈락
  function bankrupt(g, p, amount, to) {
    const me = g.players[p];
    for (const sq of owned(g, p)) {
      me.cash += sellValue(g, sq);
      release(g, sq);
    }
    give(g, to, Math.min(me.cash, amount));
    me.cash = 0;
    log(g, `${name(g, p)} 파산!`);
    knockOut(g, p);
  }

  function knockOut(g, p) {
    const me = g.players[p];
    if (me.out) return;
    me.out = true;
    me.cash = 0;
    for (const sq of owned(g, p)) release(g, sq);
    if (g.over) return;
    const alive = aliveSeats(g);
    if (alive.length === 1) {
      g.over = { winner: alive[0], reason: 'bankrupt' };
      g.pending = null;
      return;
    }
    if (g.turn === p) endTurn(g);
  }

  // 총자산 1위 (같으면 현금이 많은 쪽, 그것도 같으면 차례가 먼저인 쪽)
  function richest(g) {
    const order = aliveSeats(g).sort((a, b) => ((a - g.first + g.n) % g.n) - ((b - g.first + g.n) % g.n));
    let best = order[0];
    for (const p of order.slice(1)) {
      const d = assets(g, p) - assets(g, best);
      if (d > 0 || (d === 0 && g.players[p].cash > g.players[best].cash)) best = p;
    }
    return best;
  }

  function beginTurn(g) {
    g.phase = g.players[g.turn].travel ? 'travel' : 'roll';
  }

  function endTurn(g) {
    if (g.over) return;
    const cur = g.turn;
    g.players[cur].doubles = 0;
    g.again = false;
    g.pending = null;
    const next = nextAlive(g, cur);
    const rank = (q) => (q - g.first + g.n) % g.n;
    if (rank(next) <= rank(cur)) {
      g.round++;
      if (g.round > g.maxRounds) {
        g.over = { winner: richest(g), reason: 'rounds' };
        log(g, `${g.maxRounds}턴이 끝났습니다`);
        return;
      }
    }
    g.turn = next;
    beginTurn(g);
  }

  // 이번 칸의 일이 끝남: 더블이면 한 번 더, 아니면 다음 사람
  function finish(g) {
    if (g.over) return;
    g.pending = null;
    if (g.again && !g.players[g.turn].out) g.phase = 'roll';
    else endTurn(g);
  }

  // 앞으로 이동. 출발을 지나거나 출발에 도착하면 월급
  function forward(g, p, to, walk) {
    const me = g.players[p];
    const steps = (to - me.pos + SIZE) % SIZE;
    g.path.push({ p, from: me.pos, to, walk });
    if (me.pos + steps >= SIZE) {
      me.cash += SALARY;
      log(g, `${name(g, p)}: 출발을 지나 월급 ${money(SALARY)}`);
    }
    me.pos = to;
  }

  function sendToIsland(g, p) {
    const me = g.players[p];
    g.path.push({ p, from: me.pos, to: ISLAND, walk: false });
    me.pos = ISLAND;
    me.island = ISLAND_TURNS;
    me.doubles = 0;
    g.again = false;
  }

  // 도착한 칸의 일을 처리. 결정이 필요하면 단계만 바꾸고 멈춘다
  function land(g, p, rand) {
    const me = g.players[p];
    const sq = me.pos;
    const cell = BOARD[sq];
    switch (cell.type) {
      case 'city':
      case 'tour': {
        const owner = g.owner[sq];
        if (owner === null) {
          if (me.cash >= cell.price) { g.phase = 'buy'; return; }
          log(g, `${name(g, p)}: ${cell.name}을(를) 살 돈이 모자랍니다`);
          return finish(g);
        }
        if (owner === p) {
          if (canBuild(g, sq, me.cash)) { g.phase = 'build'; return; }
          return finish(g);
        }
        if (me.waiver > 0) {
          me.waiver--;
          log(g, `${name(g, p)}: 우대권으로 ${cell.name} 통행료 면제`);
          return finish(g);
        }
        const fee = toll(g, sq);
        log(g, `${name(g, p)} → ${name(g, owner)}: ${cell.name} 통행료 ${money(fee)}`);
        if (charge(g, p, fee, owner)) finish(g);
        return;
      }
      case 'key':
        return drawCard(g, p, rand);
      case 'island':
        me.island = ISLAND_TURNS;
        g.again = false;
        log(g, `${name(g, p)}: 무인도에 갇혔습니다 (더블이 나오면 탈출)`);
        return finish(g);
      case 'fundGet':
        log(g, `${name(g, p)}: 사회복지기금 ${money(g.fund)}을 받았습니다`);
        me.cash += g.fund;
        g.fund = 0;
        return finish(g);
      case 'fundPay':
        log(g, `${name(g, p)}: 사회복지기금 ${money(FUND_PAY)}을 냅니다`);
        if (charge(g, p, FUND_PAY, 'fund')) finish(g);
        return;
      case 'space':
        me.travel = true;
        g.again = false;
        log(g, `${name(g, p)}: 다음 차례에 원하는 칸으로 우주여행을 떠납니다`);
        return finish(g);
      default:
        return finish(g);
    }
  }

  function drawCard(g, p, rand) {
    if (!g.deck.length) g.deck = shuffle(CARDS.map((_, i) => i), rand);
    const c = CARDS[g.deck.pop()];
    const me = g.players[p];
    g.card = { p, text: c.text };
    log(g, `${name(g, p)}: 황금열쇠 — ${c.text}`);
    if (c.money > 0) {
      me.cash += c.money;
      return finish(g);
    }
    if (c.money < 0 || c.fund) {
      if (charge(g, p, c.fund || -c.money, c.fund ? 'fund' : null)) finish(g);
      return;
    }
    if (c.perBuilding) {
      const cost = owned(g, p).reduce((sum, sq) => {
        const b = g.buildings[sq];
        return sum + KINDS.reduce((s, k) => s + b[k] * c.perBuilding[k], 0);
      }, 0);
      if (!cost || charge(g, p, cost, null)) finish(g);
      return;
    }
    if (c.fromEach) {
      for (const q of aliveSeats(g)) if (q !== p) charge(g, q, c.fromEach, p);
      return finish(g);
    }
    if (c.moveTo !== undefined) {
      forward(g, p, c.moveTo, false);
      return land(g, p, rand);
    }
    if (c.moveBy > 0) {
      forward(g, p, (me.pos + c.moveBy) % SIZE, false);
      return land(g, p, rand);
    }
    if (c.moveBy < 0) {
      const to = (me.pos + c.moveBy + SIZE) % SIZE;
      g.path.push({ p, from: me.pos, to, walk: false });
      me.pos = to;
      return land(g, p, rand);
    }
    if (c.island) {
      sendToIsland(g, p);
      return finish(g);
    }
    if (c.escape) me.escape++;
    if (c.waiver) me.waiver++;
    if (c.sale) {
      const list = owned(g, p).sort((a, b) => sellValue(g, b) - sellValue(g, a));
      if (list.length) {
        const v = sellValue(g, list[0]);
        log(g, `${name(g, p)}: ${BOARD[list[0]].name} 매각 (+${money(v)})`);
        me.cash += v;
        release(g, list[0]);
      }
    }
    return finish(g);
  }

  function roll(g, p, dice, rand) {
    const me = g.players[p];
    const [d1, d2] = dice;
    const double = d1 === d2;
    g.dice = [d1, d2];
    me.travel = false;
    if (me.island > 0) {
      if (me.escape > 0) {
        me.escape--;
        me.island = 0;
        log(g, `${name(g, p)}: 무인도 탈출권 사용`);
      } else if (double) {
        me.island = 0;
        g.again = false; // 탈출한 더블로는 한 번 더 굴리지 않음
        log(g, `${name(g, p)}: 주사위 ${d1}+${d2} 더블! 무인도 탈출`);
        forward(g, p, (me.pos + d1 + d2) % SIZE, true);
        return land(g, p, rand);
      } else {
        me.island--;
        log(g, `${name(g, p)}: 주사위 ${d1}+${d2} · 무인도 ${me.island ? `${me.island}턴 남음` : '다음 차례에 나갑니다'}`);
        return endTurn(g);
      }
    }
    if (double && ++me.doubles >= 3) {
      log(g, `${name(g, p)}: 더블 3번! 무인도로 갑니다`);
      sendToIsland(g, p);
      return endTurn(g);
    }
    g.again = double;
    log(g, `${name(g, p)}: 주사위 ${d1}+${d2}${double ? ' 더블! 한 번 더' : ''}`);
    forward(g, p, (me.pos + d1 + d2) % SIZE, true);
    land(g, p, rand);
  }

  // p가 action을 한다. 잘못된 행동이면 {error}, 반영했으면 {}
  function act(g, p, action, ctx) {
    const a = action || {};
    const c = ctx || {};
    const rand = c.rand || Math.random;
    const me = g.players[p];
    if (g.over) return { error: '대국이 끝났습니다.' };
    if (!me || me.out) return { error: '탈락해서 더 둘 수 없습니다.' };
    if (p !== g.turn) return { error: '내 차례가 아닙니다.' };
    // hasOwn: type이 '__proto__'·'constructor' 같은 값이어도 Object 속성을 집지 않게
    if (!Object.hasOwn(ALLOWED, a.type) || !ALLOWED[a.type].includes(g.phase)) return { error: '지금은 할 수 없는 행동입니다.' };
    const sq = me.pos;
    const cell = BOARD[sq];

    switch (a.type) {
      case 'roll': {
        const dice = c.dice || [die(rand), die(rand)];
        fresh(g);
        roll(g, p, dice, rand);
        break;
      }
      case 'buy':
        if (me.cash < cell.price) return { error: '돈이 모자랍니다.' };
        fresh(g);
        me.cash -= cell.price;
        g.owner[sq] = p;
        log(g, `${name(g, p)}: ${cell.name} 구입 (${money(cell.price)})`);
        finish(g);
        break;
      case 'skip':
        fresh(g);
        finish(g);
        break;
      case 'build': {
        const b = g.buildings[sq], cost = BUILD_COST[row(sq)];
        const add = {};
        let total = 0, count = 0;
        for (const k of KINDS) {
          const v = Number(a[k]) || 0;
          if (!Number.isInteger(v) || v < 0 || b[k] + v > MAX[k]) return { error: '지을 수 없는 건물입니다.' };
          add[k] = v;
          total += v * cost[k];
          count += v;
        }
        if (!count) return { error: '지을 건물을 골라 주세요.' };
        if (total > me.cash) return { error: '돈이 모자랍니다.' };
        fresh(g);
        for (const k of KINDS) b[k] += add[k];
        me.cash -= total;
        const what = KINDS.filter((k) => add[k]).map((k) => `${KIND_NAMES[k]}${add[k] > 1 ? ` ${add[k]}채` : ''}`).join(', ');
        log(g, `${name(g, p)}: ${cell.name}에 ${what} 건설 (${money(total)})`);
        finish(g);
        break;
      }
      case 'sell':
      case 'autoSell': {
        const { debt, creditor } = g.pending;
        if (a.type === 'sell') {
          if (!Number.isInteger(a.sq) || g.owner[a.sq] !== p) return { error: '내 땅만 팔 수 있습니다.' };
          fresh(g);
          const v = sellValue(g, a.sq);
          me.cash += v;
          release(g, a.sq);
          log(g, `${name(g, p)}: ${BOARD[a.sq].name} 매각 (+${money(v)})`);
        } else {
          fresh(g);
          autoSell(g, p, debt);
        }
        if (me.cash >= debt) {
          me.cash -= debt;
          give(g, creditor, debt);
          log(g, `${name(g, p)}: ${money(debt)}을 냈습니다`);
          finish(g);
        }
        break;
      }
      case 'travel': {
        const to = a.to;
        if (!Number.isInteger(to) || to < 0 || to >= SIZE || to === SPACE) return { error: '갈 수 없는 칸입니다.' };
        const owner = g.owner[COLUMBIA];
        const fee = owner !== null && owner !== p ? SPACE_FEE : 0;
        if (me.cash < fee) return { error: '탑승료가 모자랍니다.' };
        fresh(g);
        me.travel = false;
        g.again = false;
        if (fee) {
          me.cash -= fee;
          give(g, owner, fee);
        }
        log(g, `${name(g, p)}: 우주여행 → ${BOARD[to].name}${fee ? ` (탑승료 ${money(fee)} → ${name(g, owner)})` : ''}`);
        forward(g, p, to, false);
        land(g, p, rand);
        break;
      }
    }
    return {};
  }

  // 결정 시간이 지났을 때 대신 할 행동
  function autoAction(g) {
    if (g.phase === 'buy' || g.phase === 'build') return { type: 'skip' };
    if (g.phase === 'sell') return { type: 'autoSell' };
    return { type: 'roll' }; // roll, travel(여행하지 않고 굴림)
  }

  // 기권·퇴장·연결 끊김으로 탈락 (땅은 은행으로)
  function eliminate(g, p) {
    if (g.over || !g.players[p] || g.players[p].out) return;
    fresh(g);
    log(g, `${name(g, p)} 탈락`);
    knockOut(g, p);
  }

  return {
    SIZE, BOARD, CARDS, KINDS, KIND_NAMES, MAX, START_CASH, SALARY, FUND_PAY, SPACE_FEE,
    ISLAND, FUND_GET, SPACE, COLUMBIA,
    buildCost: (sq) => BUILD_COST[row(sq)],
    createGame, act, autoAction, eliminate, publicView, turnOrder, aliveSeats, note: log,
    assets, toll, sellValue, canBuild, owned, isProperty, money,
  };
});
