// node tests/game.test.js —— 規則引擎：閉環、守恆、丟出、燒焦、錯菜、逾時
const assert = require('assert');
const Game = require('../shared/rules/game.js');
const levels = require('../data/levels.json');
const L11 = levels.find((l) => l.id === '1-1');
const DT = 0.05;
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
}

// 測試小工具：把 1 號玩家擺到某格、面向某方向（直接改複本，不經過 step）
const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
function at(s, x, y, dir) {
  const c = JSON.parse(JSON.stringify(s));
  const p = c.players[0];
  p.x = x + 0.5; p.y = y + 0.5; p.fx = DIRS[dir][0]; p.fy = DIRS[dir][1];
  return c;
}
// 跑一步並檢查守恆
function go(s, inp, steps = 1) {
  for (let i = 0; i < steps; i++) {
    s = Game.step(s, { 0: inp || {} }, DT);
    const errs = Game.checkInvariants(s);
    if (errs.length) throw new Error('第 ' + i + ' 步：' + errs.join(' / '));
  }
  return s;
}
const press = (s, k) => go(s, { [k]: true });
const holdUse = (s, sec) => go(s, { use: true }, Math.ceil(sec / DT));
const wait = (s, sec) => go(s, {}, Math.ceil(sec / DT));
const held = (s) => s.players[0].held && s.items[s.players[0].held];

// 1-1 的位置：番茄箱 (1,1)、生菜箱 (2,1)、砧板 (4,1)(5,1)、爐 (7,1)(8,1)、
// 盤架 (1,7)、回收口 (2,7)、出餐口 (5,7)(6,7)、水槽 (9,3)、垃圾桶 (9,7)
function newGame(dish) {
  let s = Game.createGame(L11, 1, 42);
  s = JSON.parse(JSON.stringify(s));
  s.dishes = [dish];
  return s;
}
function chopOne(s, crateX, boardX) {
  s = at(s, crateX, 2, 'N'); s = press(s, 'grab');           // 拿食材
  s = at(s, boardX, 2, 'N'); s = press(s, 'grab');           // 放砧板
  s = holdUse(s, Game.CFG.chopSec + 0.1);                    // 按住切
  s = press(s, 'grab');                                      // 拿起切好的
  assert.strictEqual(held(s).state, 'cut', '應該切好了');
  return s;
}

t('閉環：番茄湯 拿→切→下鍋 ×3→煮→裝盤→出餐→髒盤回來→洗→回盤架', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  assert.strictEqual(s.orders.length, 1, '應該有一張訂單');
  const platesStart = s.tiles['1,7'].clean;
  for (let i = 0; i < 3; i++) {
    s = chopOne(s, 1, 4);
    s = at(s, 7, 2, 'N'); s = press(s, 'grab');              // 放進鍋
  }
  assert.deepStrictEqual(s.tiles['7,1'].pot.contents, ['tomato', 'tomato', 'tomato']);
  s = wait(s, Game.CFG.cookSec + 0.1);
  assert.ok(Game.potReady(s.tiles['7,1'].pot), '應該煮好');
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');                // 拿盤子
  assert.strictEqual(s.tiles['1,7'].clean, platesStart - 1);
  s = at(s, 7, 2, 'N'); s = press(s, 'grab');                // 盛湯
  assert.deepStrictEqual(held(s).contents, ['soup:tomato']);
  s = at(s, 5, 6, 'S'); s = press(s, 'grab');                // 出餐
  assert.strictEqual(s.stats.served, 1);
  assert.ok(s.score >= 60, '分數應該至少 60，實際 ' + s.score);
  assert.strictEqual(s.orders.length, 0);
  s = wait(s, Game.CFG.returnSec + 0.1);
  assert.strictEqual(s.tiles['2,7'].dirty, 1, '髒盤應該回到回收口');
  s = at(s, 2, 6, 'S'); s = press(s, 'grab');                // 拿髒盤
  assert.ok(held(s).dirty);
  s = at(s, 8, 3, 'E'); s = press(s, 'grab');                // 放水槽
  s = holdUse(s, Game.CFG.washSec + 0.1);                    // 洗
  assert.strictEqual(s.tiles['1,7'].clean, platesStart, '洗好的盤子回到盤架，數量回到原點');
  assert.strictEqual(s.stats.spawned, 3); assert.strictEqual(s.stats.merged, 3);
});

t('閉環：沙拉 生菜＋番茄 都要切，放在檯面上裝盤', () => {
  let s = newGame('salad');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');                // 拿盤子
  s = at(s, 3, 2, 'N'); s = press(s, 'grab');                // 放在檯面 (3,1)
  s = chopOne(s, 2, 4);                                      // 切生菜
  s = at(s, 3, 2, 'N'); s = press(s, 'grab');                // 裝到檯面上的盤子
  s = chopOne(s, 1, 5);                                      // 切番茄
  s = at(s, 3, 2, 'N'); s = press(s, 'grab');
  s = press(s, 'grab');                                      // 拿起盤子
  assert.deepStrictEqual(held(s).contents.slice().sort(), ['lettuce:cut', 'tomato:cut']);
  s = at(s, 6, 6, 'S'); s = press(s, 'grab');
  assert.strictEqual(s.stats.served, 1);
});

t('生的食材不能裝盤、不能下鍋做湯', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 7, 2, 'N'); s = press(s, 'grab');
  assert.strictEqual(s.tiles['7,1'].pot.contents.length, 0);
  assert.strictEqual(held(s).state, 'raw');
});

t('鍋子只收同一種食材（番茄鍋放不進洋蔥、也放不進生菜）', () => {
  let s = newGame('tomato_soup'); s.dishes = ['tomato_soup', 'onion_soup', 'salad'];
  s.tiles['2,1'].item = 'onion';                                      // 測試用：把生菜箱換成洋蔥箱
  s = chopOne(s, 1, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab');
  s = chopOne(s, 2, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab');   // 洋蔥放不進番茄鍋
  assert.deepStrictEqual(s.tiles['7,1'].pot.contents, ['tomato']);
  assert.strictEqual(held(s).name, 'onion');
  s = at(s, 8, 2, 'N'); s = press(s, 'grab');                         // 旁邊的空鍋可以
  assert.deepStrictEqual(s.tiles['8,1'].pot.contents, ['onion']);
});

t('丟出：隔兩格把切好的番茄丟進鍋', () => {
  let s = newGame('tomato_soup');
  s = chopOne(s, 1, 4);
  s = at(s, 7, 3, 'N'); s = press(s, 'throw');               // (7,3) 往上，經過 (7,2) 進 (7,1) 的鍋
  s = wait(s, 0.5);
  assert.deepStrictEqual(s.tiles['7,1'].pot.contents, ['tomato']);
  assert.ok(!s.players[0].held);
});

t('丟出：撞牆掉在地上，可以撿回來', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 4, 4, 'E'); s = press(s, 'throw');               // 往右飛 4 格，停在地板
  s = wait(s, 0.6);
  const it = Object.values(s.items)[0];
  assert.ok(it.at.floor, '應該在地上');
  const fx = Math.floor(it.at.floor[0]), fy = Math.floor(it.at.floor[1]);
  s = at(s, fx - 1, fy, 'E'); s = press(s, 'grab');
  assert.ok(held(s), '應該撿回來');
});

t('盤子不能丟', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');
  s = press(s, 'throw');
  assert.ok(held(s) && held(s).kind === 'plate');
});

t('煮過頭會燒焦，按住互動清掉', () => {
  let s = newGame('tomato_soup');
  for (let i = 0; i < 3; i++) { s = chopOne(s, 1, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab'); }
  s = wait(s, Game.CFG.cookSec + Game.CFG.burnSec + 0.2);
  assert.ok(s.tiles['7,1'].pot.burnt);
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');
  s = at(s, 7, 2, 'N'); s = press(s, 'grab');
  assert.deepStrictEqual(held(s).contents, [], '燒焦的不能盛');
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');                // 盤子放回盤架
  s = at(s, 7, 2, 'N'); s = go(s, { use: true });
  assert.ok(!s.tiles['7,1'].pot.burnt && s.tiles['7,1'].pot.contents.length === 0);
});

t('錯的菜不能出餐，盤子留在手上', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  s.dishes = ['tomato_soup', 'salad'];
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');
  s = at(s, 3, 2, 'N'); s = press(s, 'grab');
  s = chopOne(s, 2, 4); s = at(s, 3, 2, 'N'); s = press(s, 'grab'); s = press(s, 'grab');
  s = at(s, 5, 6, 'S'); s = press(s, 'grab');
  assert.strictEqual(s.stats.served, 0);
  assert.ok(held(s) && held(s).kind === 'plate');
});

t('訂單逾時扣分', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + Game.CFG.patience.tomato_soup + 0.2);
  assert.ok(s.stats.failed >= 1);
  assert.strictEqual(s.score, -Game.CFG.expirePenalty * s.stats.failed);
});

t('垃圾桶：丟掉食材，計數守恆', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 8, 6, 'E'); s = go(s, {}, 1);
  s = at(s, 9, 6, 'S'); s = press(s, 'grab');
  assert.strictEqual(s.stats.trashed, 1);
  assert.ok(!s.players[0].held);
});

t('碰撞：不能走進牆裡', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'W');
  s = go(s, { mx: -1, my: 0 }, 40);
  assert.ok(s.players[0].x > 1.3, '應該被牆擋住，x=' + s.players[0].x);
});

t('時間到結束，之後不再變化', () => {
  let s = newGame('tomato_soup');
  s = wait(s, L11.timeSec + 0.1);
  assert.ok(s.ended);
  const before = JSON.stringify(s); s = Game.step(s, { 0: { mx: 1 } }, DT);
  assert.strictEqual(JSON.stringify({ ...s, events: [] }), JSON.stringify({ ...JSON.parse(before), events: [] }));
});

t('step 不修改傳入的 state', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N');
  const before = JSON.stringify(s);
  Game.step(s, { 0: { grab: true, mx: 0.5 } }, DT);
  assert.strictEqual(JSON.stringify(s), before);
});

t('同樣的種子、同樣的操作，結果完全一樣', () => {
  const run = () => { let s = Game.createGame(levels[4], 3, 7); for (let i = 0; i < 400; i++) s = Game.step(s, {}, DT); return s.orders.map((o) => o.dish).join(); };
  assert.strictEqual(run(), run());
});

t('5 關、1–8 人都能開局，守恆成立', () => {
  levels.forEach((lv) => { for (let n = 1; n <= 8; n++) {
    let s = Game.createGame(lv, n, 1);
    assert.strictEqual(s.players.length, n);
    for (let i = 0; i < 20; i++) s = Game.step(s, {}, DT);
    assert.deepStrictEqual(Game.checkInvariants(s), [], lv.id + ' ' + n + ' 人');
  } });
});

t('提示：面前是番茄箱時，「拿」會拿番茄', () => {
  let s = newGame('tomato_soup'); s = at(s, 1, 2, 'N');
  const d = Game.describe(s, 0);
  assert.strictEqual(d.target, '番茄箱'); assert.strictEqual(d.grab, '拿番茄');
});

// 突變：守恆檢查真的會抓到錯
t('突變：盤子憑空多一個 → 守恆檢查報錯', () => {
  let s = newGame('tomato_soup'); s.tiles['1,7'].clean++;
  assert.ok(Game.checkInvariants(s).some((e) => /盤子/.test(e)));
});
t('突變：食材憑空消失 → 守恆檢查報錯', () => {
  let s = newGame('tomato_soup'); s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  delete s.items[s.players[0].held]; s.players[0].held = null;
  assert.ok(Game.checkInvariants(s).some((e) => /食材/.test(e)));
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
