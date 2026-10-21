const test = require('node:test');
const assert = require('node:assert');
const M = require('../shared/marble');

const game = (n = 2, opts = {}) => M.createGame(n, { names: ['가', '나', '다', '라'].slice(0, n), rand: () => 0, ...opts });
const roll = (g, p, d1, d2) => M.act(g, p, { type: 'roll' }, { dice: [d1, d2] });
const card = (re) => M.CARDS.findIndex((c) => re.test(c.text));

test('시작 상태', () => {
  const g = game(3, { first: 1 });
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.phase, 'roll');
  assert.ok(g.players.every((p) => p.cash === M.START_CASH && p.pos === 0));
  assert.strictEqual(M.BOARD.length, M.SIZE);
  assert.deepStrictEqual(M.turnOrder(3), [0, 1, 2]);
});

test('차례와 단계 검증', () => {
  const g = game();
  assert.match(roll(g, 1, 1, 2).error, /차례/);
  assert.match(M.act(g, 0, { type: 'buy' }).error, /할 수 없는/);
  assert.match(M.act(g, 0, null).error, /할 수 없는/);
  for (const type of ['__proto__', 'constructor', 'toString', 5]) {
    assert.match(M.act(g, 0, { type }).error, /할 수 없는/, `type: ${type}`);
  }
  assert.strictEqual(g.seq, 0, '오류면 상태가 바뀌지 않음');
});

test('빈 땅에 도착하면 구입', () => {
  const g = game();
  assert.deepStrictEqual(roll(g, 0, 1, 2), {});
  assert.strictEqual(g.players[0].pos, 3);
  assert.strictEqual(g.phase, 'buy');
  M.act(g, 0, { type: 'buy' });
  assert.strictEqual(g.owner[3], 0);
  assert.strictEqual(g.players[0].cash, M.START_CASH - M.BOARD[3].price);
  assert.strictEqual(g.turn, 1, '구입 후 다음 사람 차례');
  assert.strictEqual(g.phase, 'roll');
});

test('남의 땅이면 통행료', () => {
  const g = game();
  g.owner[3] = 1;
  roll(g, 0, 1, 2);
  const fee = M.toll(g, 3);
  assert.ok(fee > 0);
  assert.strictEqual(g.players[0].cash, M.START_CASH - fee);
  assert.strictEqual(g.players[1].cash, M.START_CASH + fee);
  assert.strictEqual(g.turn, 1);
});

test('우대권이 있으면 통행료 면제', () => {
  const g = game();
  g.owner[3] = 1;
  g.players[0].waiver = 1;
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].cash, M.START_CASH);
  assert.strictEqual(g.players[0].waiver, 0);
});

test('출발을 지나면 월급', () => {
  const g = game();
  g.players[0].pos = 36;
  roll(g, 0, 2, 3);
  assert.strictEqual(g.players[0].pos, 1);
  assert.strictEqual(g.players[0].cash, M.START_CASH + M.SALARY);
  assert.deepStrictEqual(g.path, [{ p: 0, from: 36, to: 1, walk: true }]);
});

test('내 도시에 다시 오면 건물 건설', () => {
  const g = game();
  g.owner[3] = 0;
  const before = M.toll(g, 3);
  roll(g, 0, 1, 2);
  assert.strictEqual(g.phase, 'build');
  assert.match(M.act(g, 0, { type: 'build', villa: 3 }).error, /지을 수 없는/);
  assert.match(M.act(g, 0, { type: 'build' }).error, /골라/);
  assert.match(M.act(g, 0, { type: 'build', villa: 1.5 }).error, /지을 수 없는/);
  M.act(g, 0, { type: 'build', villa: 2, building: 1 });
  assert.deepStrictEqual(g.buildings[3], { villa: 2, building: 1, hotel: 0 });
  const cost = M.buildCost(3);
  assert.strictEqual(g.players[0].cash, M.START_CASH - 2 * cost.villa - cost.building);
  assert.ok(M.toll(g, 3) > before, '건물을 지으면 통행료가 오름');
  assert.strictEqual(g.turn, 1);
});

test('관광지에는 건물을 지을 수 없음', () => {
  const g = game();
  g.owner[5] = 0;
  roll(g, 0, 2, 3);
  assert.strictEqual(g.turn, 1, '건설 단계 없이 차례가 넘어감');
});

test('더블이면 한 번 더, 3번 연속이면 무인도', () => {
  const g = game();
  roll(g, 0, 2, 2); // 4 마닐라
  M.act(g, 0, { type: 'skip' });
  assert.strictEqual(g.turn, 0, '더블이라 한 번 더');
  assert.strictEqual(g.phase, 'roll');
  roll(g, 0, 2, 2); // 8 카이로
  M.act(g, 0, { type: 'skip' });
  assert.strictEqual(g.turn, 0);
  roll(g, 0, 2, 2);
  assert.strictEqual(g.players[0].pos, M.ISLAND);
  assert.strictEqual(g.players[0].island, 3);
  assert.strictEqual(g.turn, 1);
});

test('무인도: 더블이면 탈출, 아니면 3턴 쉼', () => {
  const g = game();
  g.players[0].pos = M.ISLAND;
  g.players[0].island = 3;
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].pos, M.ISLAND);
  assert.strictEqual(g.players[0].island, 2);
  roll(g, 1, 1, 2); M.act(g, 1, { type: 'skip' });
  roll(g, 0, 2, 2); // 더블 → 14 스톡홀름
  assert.strictEqual(g.players[0].pos, 14);
  assert.strictEqual(g.players[0].island, 0);
  M.act(g, 0, { type: 'skip' });
  assert.strictEqual(g.turn, 1, '탈출한 더블로는 한 번 더 굴리지 않음');

  const h = game();
  h.players[0].pos = M.ISLAND;
  h.players[0].island = 1;
  roll(h, 0, 1, 2);
  assert.strictEqual(h.players[0].island, 0);
  assert.strictEqual(h.players[0].pos, M.ISLAND);
  roll(h, 1, 1, 2); M.act(h, 1, { type: 'skip' });
  roll(h, 0, 1, 2);
  assert.strictEqual(h.players[0].pos, 13, '3턴이 지나면 다시 움직임');
});

test('무인도 탈출권', () => {
  const g = game();
  g.players[0].pos = M.ISLAND;
  g.players[0].island = 3;
  g.players[0].escape = 1;
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].pos, 13);
  assert.strictEqual(g.players[0].escape, 0);
});

test('우주여행: 다음 차례에 원하는 칸으로, 탑승료는 컬럼비아호 주인에게', () => {
  const g = game();
  g.players[0].pos = 27;
  g.owner[M.COLUMBIA] = 1;
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].pos, M.SPACE);
  assert.strictEqual(g.turn, 1);
  roll(g, 1, 1, 2); M.act(g, 1, { type: 'skip' });
  assert.strictEqual(g.phase, 'travel');
  assert.match(M.act(g, 0, { type: 'travel', to: M.SPACE }).error, /갈 수 없는/);
  assert.match(M.act(g, 0, { type: 'travel', to: '5' }).error, /갈 수 없는/);
  M.act(g, 0, { type: 'travel', to: 5 });
  assert.strictEqual(g.players[0].pos, 5);
  assert.strictEqual(g.players[0].cash, M.START_CASH - M.SPACE_FEE + M.SALARY, '탑승료를 내고, 출발을 지나 월급');
  assert.strictEqual(g.players[1].cash, M.START_CASH + M.SPACE_FEE);
  assert.strictEqual(g.phase, 'buy');
});

test('우주여행 대신 그냥 굴릴 수도 있음', () => {
  const g = game();
  g.players[0].pos = M.SPACE;
  g.players[0].travel = true;
  g.phase = 'travel';
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].pos, 33);
  assert.strictEqual(g.players[0].travel, false);
});

test('사회복지기금 내기와 받기', () => {
  const g = game();
  g.players[0].pos = 36;
  roll(g, 0, 1, 1); // 38 접수처
  assert.strictEqual(g.fund, M.FUND_PAY);
  assert.strictEqual(g.players[0].cash, M.START_CASH - M.FUND_PAY);
  assert.strictEqual(g.turn, 0, '더블이라 한 번 더');
  g.turn = 1;
  g.players[1].pos = 18;
  roll(g, 1, 1, 1); // 20 수령처
  assert.strictEqual(g.fund, 0);
  assert.strictEqual(g.players[1].cash, M.START_CASH + M.FUND_PAY);
});

test('황금열쇠: 돈 받기, 이동, 뒤로 가서 무인도, 생일', () => {
  const g = game(3);
  g.deck = [card(/복권/)];
  roll(g, 0, 1, 1); // 2 황금열쇠
  assert.strictEqual(g.players[0].cash, M.START_CASH + 200000);
  assert.deepStrictEqual(g.card, { p: 0, text: M.CARDS[card(/복권/)].text });

  const h = game();
  h.deck = [card(/서울로/)];
  h.players[0].pos = 4;
  roll(h, 0, 1, 2); // 7 → 서울
  assert.strictEqual(h.players[0].pos, 39);
  assert.strictEqual(h.phase, 'buy');
  assert.strictEqual(h.path.length, 2);

  const k = game();
  k.deck = [card(/뒤로 2칸/)];
  k.players[0].pos = 9;
  roll(k, 0, 1, 2); // 12 → 10 무인도
  assert.strictEqual(k.players[0].pos, M.ISLAND);
  assert.strictEqual(k.players[0].island, 3);
  assert.strictEqual(k.turn, 1);

  const b = game(3);
  b.deck = [card(/생일/)];
  roll(b, 0, 1, 1);
  assert.strictEqual(b.players[0].cash, M.START_CASH + 100000);
  assert.strictEqual(b.players[1].cash, M.START_CASH - 50000);
});

test('황금열쇠 덱이 비면 다시 섞음', () => {
  const g = game();
  g.deck = [];
  roll(g, 0, 1, 1);
  assert.ok(g.card);
  assert.strictEqual(g.deck.length, M.CARDS.length - 1);
});

test('돈이 모자라면 땅을 골라 팔아서 갚음', () => {
  const g = game();
  g.owner[37] = 1; // 뉴욕 (땅만)
  g.owner[1] = 0;
  g.owner[3] = 0;
  g.players[0].cash = 50000;
  g.players[0].pos = 34;
  roll(g, 0, 1, 2);
  const fee = M.toll(g, 37);
  assert.strictEqual(g.phase, 'sell');
  assert.deepStrictEqual(g.pending, { debt: fee, creditor: 1 });
  assert.match(M.act(g, 0, { type: 'sell', sq: 5 }).error, /내 땅/);
  M.act(g, 0, { type: 'sell', sq: 3 });
  assert.strictEqual(g.owner[3], null);
  assert.strictEqual(g.players[0].cash, 50000 + M.sellValue(g, 3) - fee);
  assert.strictEqual(g.players[1].cash, M.START_CASH + fee);
  assert.strictEqual(g.owner[1], 0, '빚을 갚으면 나머지 땅은 남음');
  assert.strictEqual(g.turn, 1);
});

test('자동 매각은 싼 땅부터', () => {
  const g = game();
  g.owner[37] = 1;
  g.owner[1] = 0;  // 타이베이 (싼 땅)
  g.owner[39] = 0; // 서울
  g.players[0].cash = 50000;
  g.players[0].pos = 34;
  roll(g, 0, 1, 2);
  assert.deepStrictEqual(M.autoAction(g), { type: 'autoSell' });
  M.act(g, 0, M.autoAction(g));
  assert.strictEqual(g.owner[1], null);
  assert.strictEqual(g.owner[39], 0);
  assert.strictEqual(g.turn, 1);
});

test('땅을 다 팔아도 못 갚으면 파산', () => {
  const g = game(3);
  g.owner[39] = 1; // 서울 통행료 200만
  g.owner[1] = 0;
  g.players[0].cash = 100000;
  g.players[0].pos = 36;
  roll(g, 0, 1, 2);
  assert.strictEqual(g.players[0].out, true);
  assert.strictEqual(g.owner[1], null, '땅은 은행으로');
  assert.strictEqual(g.players[1].cash, M.START_CASH + 100000 + M.sellValue(g, 1), '가진 것을 전부 받음');
  assert.strictEqual(g.turn, 1);
  assert.strictEqual(g.over, null);

  const h = game();
  h.owner[39] = 1;
  h.players[0].cash = 0;
  h.players[0].pos = 36;
  roll(h, 0, 1, 2);
  assert.deepStrictEqual(h.over, { winner: 1, reason: 'bankrupt' });
});

test('정한 턴 수가 지나면 총자산 1위가 승리', () => {
  const g = game(2, { maxRounds: 1 });
  g.owner[9] = 1;
  roll(g, 0, 1, 2); M.act(g, 0, { type: 'skip' });
  assert.strictEqual(g.over, null);
  roll(g, 1, 1, 2); M.act(g, 1, { type: 'skip' });
  assert.deepStrictEqual(g.over, { winner: 1, reason: 'rounds' });
  assert.ok(M.assets(g, 1) > M.assets(g, 0));
});

test('시간 초과 때 대신 할 행동', () => {
  const g = game();
  assert.deepStrictEqual(M.autoAction(g), { type: 'roll' });
  g.phase = 'buy';
  assert.deepStrictEqual(M.autoAction(g), { type: 'skip' });
  g.phase = 'build';
  assert.deepStrictEqual(M.autoAction(g), { type: 'skip' });
  g.phase = 'travel';
  assert.deepStrictEqual(M.autoAction(g), { type: 'roll' });
});

test('기권·퇴장으로 탈락', () => {
  const g = game(3);
  g.owner[3] = 0;
  M.eliminate(g, 0);
  assert.strictEqual(g.players[0].out, true);
  assert.strictEqual(g.owner[3], null);
  assert.strictEqual(g.turn, 1, '탈락자 차례면 다음 사람으로');
  M.eliminate(g, 2);
  assert.deepStrictEqual(g.over, { winner: 1, reason: 'bankrupt' });
});

test('공개 상태에는 카드 순서가 없음', () => {
  const g = game();
  const view = M.publicView(g);
  assert.strictEqual(view.deck, undefined);
  assert.ok(Array.isArray(g.deck));
  assert.strictEqual(M.money(150000), '15만');
  assert.strictEqual(M.money(5000), '0.5만');
  assert.strictEqual(M.money(10000000), '1,000만');
});
