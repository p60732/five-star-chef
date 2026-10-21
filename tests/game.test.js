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
const potAt = (s, k) => s.items[s.tiles[k].holds];   // 爐子上的鍋
const firstIng = (s) => Object.values(s.items).find((i) => i.kind === 'ing');

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
  assert.deepStrictEqual(potAt(s, '7,1').contents, ['tomato', 'tomato', 'tomato']);
  s = wait(s, Game.CFG.cookSec + 0.1);
  assert.ok(Game.potReady(potAt(s, '7,1')), '應該煮好');
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
  const dry = s.items[s.tiles['9,4'].holds];
  assert.ok(dry && dry.kind === 'plate' && !dry.dirty, '洗好的盤子出現在水槽旁的檯面 (9,4)');
  s = at(s, 8, 4, 'E'); s = press(s, 'grab');                // 從旁邊檯面拿乾淨盤子
  assert.ok(held(s) && held(s).kind === 'plate' && !held(s).dirty);
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');                // 放回盤架
  assert.strictEqual(s.tiles['1,7'].clean, platesStart, '盤子回到原點');
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
  assert.strictEqual(potAt(s, '7,1').contents.length, 0);
  assert.strictEqual(held(s).state, 'raw');
});

t('鍋子只收同一種食材（番茄鍋放不進洋蔥、也放不進生菜）', () => {
  let s = newGame('tomato_soup'); s.dishes = ['tomato_soup', 'onion_soup', 'salad'];
  s.tiles['2,1'].item = 'onion';                                      // 測試用：把生菜箱換成洋蔥箱
  s = chopOne(s, 1, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab');
  s = chopOne(s, 2, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab');   // 洋蔥放不進番茄鍋
  assert.deepStrictEqual(potAt(s, '7,1').contents, ['tomato']);
  assert.strictEqual(held(s).name, 'onion');
  s = at(s, 8, 2, 'N'); s = press(s, 'grab');                         // 旁邊的空鍋可以
  assert.deepStrictEqual(potAt(s, '8,1').contents, ['onion']);
});

t('丟出：隔兩格把切好的番茄丟進鍋', () => {
  let s = newGame('tomato_soup');
  s = chopOne(s, 1, 4);
  s = at(s, 7, 3, 'N'); s = press(s, 'throw');               // (7,3) 往上，經過 (7,2) 進 (7,1) 的鍋
  s = wait(s, 0.5);
  assert.deepStrictEqual(potAt(s, '7,1').contents, ['tomato']);
  assert.ok(!s.players[0].held);
});

t('拿著東西、身邊的工作台都放不下時，東西留在手上不會掉', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');                // 生番茄
  s = at(s, 7, 2, 'N'); s = press(s, 'grab');                // 爐子不收生番茄
  assert.ok(held(s) && held(s).name === 'tomato');
});

t('丟出：撞牆掉在地上，可以撿回來', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 3, 4, 'E'); s = press(s, 'throw');               // 往右拋，落地彈一下、滑一點停住
  s = wait(s, 1.5);
  const it = firstIng(s);
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

t('煮過頭會燒焦；空手按動作只會把鍋子拿起來，不會直接清掉', () => {
  let s = newGame('tomato_soup');
  for (let i = 0; i < 3; i++) { s = chopOne(s, 1, 4); s = at(s, 7, 2, 'N'); s = press(s, 'grab'); }
  s = wait(s, Game.CFG.cookSec + Game.CFG.burnSec + 0.2);
  assert.ok(potAt(s, '7,1').burnt);
  s = at(s, 7, 2, 'N'); s = press(s, 'act');
  assert.ok(held(s).kind === 'pot' && held(s).burnt, '拿起燒焦的鍋');
});

t('送錯餐：照樣送出、扣分，訂單還在，盤子之後會回來', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  s.dishes = ['tomato_soup', 'salad'];
  s = at(s, 1, 6, 'S'); s = press(s, 'grab');
  s = at(s, 3, 2, 'N'); s = press(s, 'grab');
  s = chopOne(s, 2, 4); s = at(s, 3, 2, 'N'); s = press(s, 'grab'); s = press(s, 'grab');
  s = at(s, 5, 6, 'S');
  assert.strictEqual(Game.describe(s, 0).act, '出餐（不是訂單上的菜，會扣分）');
  const orders = s.orders.length;
  s = press(s, 'act');
  assert.ok(!s.players[0].held, '盤子送出去了');
  assert.strictEqual(s.stats.served, 0); assert.strictEqual(s.stats.wrong, 1);
  assert.strictEqual(s.score, -Game.CFG.wrongPenalty);
  assert.strictEqual(s.orders.length, orders, '訂單還在');
  assert.deepStrictEqual(Game.checkInvariants(s), []);
  s = wait(s, Game.CFG.returnSec + 0.1);
  assert.strictEqual(s.tiles['2,7'].dirty, 1, '盤子回到回收口');
});

t('訂單逾時扣分', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  s = wait(s, s.orders[0].total + 0.2);
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

t('切菜：按一下就自動切完，不用一直按', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 4, 2, 'N'); s = press(s, 'grab');
  s = press(s, 'use');
  s = wait(s, Game.CFG.chopSec + 0.1);
  assert.strictEqual(s.items[s.tiles['4,1'].holds].state, 'cut');
});

t('切菜：走開會中斷，回來繼續切，進度保留', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 4, 2, 'N'); s = press(s, 'grab');
  s = press(s, 'use'); s = wait(s, Game.CFG.chopSec / 2);
  s = go(s, { mx: 0, my: 1 }, 4);
  const it = s.items[s.tiles['4,1'].holds];
  assert.ok(it.chop > 0.2 && it.chop < 1, '進度應該停在一半，實際 ' + it.chop);
  assert.ok(!s.players[0].busy, '走開就不再切');
  const before = it.chop;
  s = at(s, 4, 2, 'N'); s = press(s, 'use'); s = wait(s, Game.CFG.chopSec * (1 - before) + 0.1);
  assert.strictEqual(s.items[s.tiles['4,1'].holds].state, 'cut');
});

t('洗碗：按一下會把水槽裡的盤子一個接一個洗完', () => {
  let s = newGame('tomato_soup');
  s.tiles['9,3'].dirty = 2; s.tiles['1,7'].clean -= 2;      // 測試用：兩個髒盤放進水槽
  s = at(s, 8, 3, 'E'); s = press(s, 'use');
  s = wait(s, Game.CFG.washSec * 2 + 0.2);
  assert.strictEqual(s.tiles['9,3'].dirty, 0);
  assert.strictEqual(s.items[s.tiles['9,4'].holds].n, 2, '兩個洗好的盤子疊在 (9,4)');
});

t('對準：沒有正對著也能拿到斜前方的生菜箱', () => {
  let s = newGame('salad');
  s = at(s, 3, 2, 'N'); s.players[0].fx = -0.6; s.players[0].fy = -0.8;   // 面向左上，正前方是空檯面
  s = press(s, 'grab');
  assert.ok(held(s) && held(s).name === 'lettuce', '應該拿到 (2,1) 的生菜');
});

t('對準：正前方有反應的格子優先', () => {
  let s = newGame('salad');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  assert.strictEqual(held(s).name, 'tomato');
});

t('對準：拿著東西時，跳過放不下的格子，放到旁邊空的檯面', () => {
  let s = newGame('salad');
  s = at(s, 2, 2, 'N'); s = press(s, 'grab');                // 拿生菜
  s = at(s, 3, 2, 'N'); s.players[0].fx = -0.4; s.players[0].fy = -0.9;  // 偏向生菜箱，但箱子放不了東西
  s = press(s, 'grab');
  assert.ok(s.tiles['3,1'].holds, '應該放在 (3,1) 檯面上');
});

t('搖桿：中心一小圈不會動；推一點是慢走', () => {
  let s = newGame('salad'); s = at(s, 5, 4, 'N');
  const x0 = s.players[0].x;
  s = go(s, { mx: Game.CFG.deadzone * 0.8, my: 0 }, 10);
  assert.strictEqual(s.players[0].x, x0, '死區內不能動');
  s = go(s, { mx: 0.4, my: 0 }, 10);
  const slow = s.players[0].x - x0;
  s = at(s, 5, 4, 'N'); const x1 = s.players[0].x;
  s = go(s, { mx: 1, my: 0 }, 10);
  assert.ok(slow > 0 && slow < (s.players[0].x - x1) * 0.7, '慢走應該明顯比全速慢');
});

t('1 人：訂單間隔比較長、同時最多 2 張、客人比較有耐心', () => {
  const s1 = Game.createGame(L11, 1, 1), s4 = Game.createGame(L11, 4, 1);
  assert.ok(s1.difficulty.orderEverySec >= 30); assert.strictEqual(s1.difficulty.maxOrders, 2);
  let a = s1, b = s4;
  for (let i = 0; i < 60; i++) { a = Game.step(a, {}, DT); b = Game.step(b, {}, DT); }
  assert.ok(a.orders[0].total > b.orders[0].total, '1 人的耐心應該比 4 人長');
});

t('一顆鍵：砧板上有生菜 → 切；切好 → 拿起來', () => {
  let s = newGame('salad');
  s = at(s, 2, 2, 'N'); s = press(s, 'act');                 // 拿生菜
  assert.strictEqual(held(s).name, 'lettuce');
  s = at(s, 4, 2, 'N'); s = press(s, 'act');                 // 放上砧板
  assert.ok(s.tiles['4,1'].holds);
  s = press(s, 'act');                                       // 再按 → 開始切
  assert.strictEqual(s.players[0].busy && s.players[0].busy.kind, 'chop');
  s = wait(s, Game.CFG.chopSec + 0.1);
  assert.strictEqual(s.items[s.tiles['4,1'].holds].state, 'cut');
  s = press(s, 'act');                                       // 切好了 → 拿起來
  assert.ok(held(s) && held(s).state === 'cut');
});

t('一顆鍵：空手對水槽 → 洗；拿著髒盤對水槽 → 放進去', () => {
  let s = newGame('tomato_soup');
  s.tiles['2,7'].dirty = 1; s.tiles['1,7'].clean -= 1;
  s = at(s, 2, 6, 'S'); s = press(s, 'act');                 // 拿髒盤
  assert.ok(held(s).dirty);
  s = at(s, 8, 3, 'E'); s = press(s, 'act');                 // 放進水槽
  assert.strictEqual(s.tiles['9,3'].dirty, 1);
  s = press(s, 'act');                                       // 空手再按 → 洗
  s = wait(s, Game.CFG.washSec + 0.1);
  assert.ok(s.tiles['9,4'].holds, '洗好的盤子在水槽旁的檯面');
  s = at(s, 8, 4, 'E'); s = press(s, 'act');
  assert.ok(held(s) && held(s).kind === 'plate' && !held(s).dirty);
});

t('一顆鍵：番茄湯完整閉環只用移動、主按鍵', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  for (let i = 0; i < 3; i++) {
    s = at(s, 1, 2, 'N'); s = press(s, 'act');
    s = at(s, 4, 2, 'N'); s = press(s, 'act'); s = press(s, 'act'); s = wait(s, Game.CFG.chopSec + 0.1); s = press(s, 'act');
    s = at(s, 7, 2, 'N'); s = press(s, 'act');
  }
  s = wait(s, Game.CFG.cookSec + 0.1);
  s = at(s, 1, 6, 'S'); s = press(s, 'act');
  s = at(s, 7, 2, 'N'); s = press(s, 'act');
  s = at(s, 5, 6, 'S'); s = press(s, 'act');
  assert.strictEqual(s.stats.served, 1);
});

t('燒焦：把鍋子搬去垃圾桶倒掉，再放回爐子', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: 99, burnt: true });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 拿起焦鍋
  const pid = s.players[0].held;
  assert.ok(!s.tiles['7,1'].holds, '爐子上沒有鍋了');
  s = at(s, 9, 6, 'S');
  assert.strictEqual(Game.describe(s, 0).act, '倒掉鍋裡的東西');
  s = press(s, 'act');
  assert.ok(!s.items[pid].burnt && !s.items[pid].contents.length, '鍋子倒乾淨了');
  assert.strictEqual(s.players[0].held, pid, '鍋子還在手上');
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 放回爐子
  assert.strictEqual(s.tiles['7,1'].holds, pid);
});

t('提示：主按鍵標籤會跟著情況變', () => {
  let s = newGame('salad');
  s = at(s, 2, 2, 'N'); assert.strictEqual(Game.describe(s, 0).act, '拿生菜');
  s = press(s, 'act'); s = at(s, 4, 2, 'N'); assert.strictEqual(Game.describe(s, 0).act, '放下');
  s = press(s, 'act'); assert.strictEqual(Game.describe(s, 0).act, '切');
});

const L12 = levels.find((l) => l.id === '1-2');
// 1-2 位置：洋蔥箱 (2,1)、檯面 (3,1)(5,1)、砧板 (4,1)、盤架 (11,7)、爐 (8,1)(9,1)(10,1)
t('拿空盤去砧板接切好的湯料（只有湯的關卡也可以）', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 4, 2, 'N'); s = press(s, 'act'); s = press(s, 'act'); s = wait(s, Game.CFG.chopSec + 0.1);
  s = at(s, 10, 7, 'E'); s = press(s, 'act');                // 拿空盤
  assert.ok(held(s).kind === 'plate');
  s = at(s, 4, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '裝盤');
  s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['onion:cut']);
});

t('托盤：一盤裝 3 份切好的洋蔥，整盤倒進鍋', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 10, 7, 'E'); s = press(s, 'act');                // 拿空盤
  s = at(s, 5, 2, 'N'); s = press(s, 'act');                 // 盤子放在 (5,1) 檯面
  for (let i = 0; i < 3; i++) {
    s = at(s, 2, 2, 'N'); s = press(s, 'act');
    s = at(s, 4, 2, 'N'); s = press(s, 'act'); s = press(s, 'act'); s = wait(s, Game.CFG.chopSec + 0.1); s = press(s, 'act');
    s = at(s, 5, 2, 'N'); s.players[0].fx = 0; s = press(s, 'act');               // 裝進檯面上的盤子
  }
  s = press(s, 'act');                                       // 拿起盤子
  assert.deepStrictEqual(held(s).contents, ['onion:cut', 'onion:cut', 'onion:cut']);
  s = at(s, 8, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '倒進鍋');
  s = press(s, 'act');
  assert.deepStrictEqual(potAt(s, '8,1').contents, ['onion', 'onion', 'onion']);
  assert.deepStrictEqual(held(s).contents, [], '倒完盤子是空的、還在手上');
  s = wait(s, Game.CFG.cookSec + 0.1);
  s = press(s, 'act');                                       // 用同一個盤子盛湯
  assert.deepStrictEqual(held(s).contents, ['soup:onion']);
});

t('托盤不能混不同食材、也不能超過 3 份', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 10, 7, 'E'); s = press(s, 'act');
  const pid = s.players[0].held;
  s.items[pid].contents = ['onion:cut', 'onion:cut', 'onion:cut'];
  s.stats.spawned += 3; s.stats.merged += 3;
  s.items['x1'] = { id: 'x1', kind: 'ing', name: 'tomato', state: 'cut', chop: 1, at: { tile: '4,1' } };
  s.tiles['4,1'].holds = 'x1'; s.stats.spawned += 1;
  s = at(s, 4, 2, 'N'); s = press(s, 'act');
  assert.strictEqual(held(s).contents.length, 3);
  assert.ok(s.tiles['4,1'].holds, '番茄應該還在砧板上');
});

t('鍋子煮好時拿空盤 → 盛起來', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: Game.CFG.cookSec + 1, burnt: false });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 1, 6, 'S'); s = press(s, 'act');
  s = at(s, 7, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '盛到盤子');
  s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['soup:tomato']);
});

t('拿著盤子可以接住隊友丟來切好的食材', () => {
  let s = Game.createGame(L11, 2, 1);
  s = JSON.parse(JSON.stringify(s)); s.dishes = ['salad'];
  const p0 = s.players[0], p1 = s.players[1];
  s.items['x1'] = { id: 'x1', kind: 'ing', name: 'tomato', state: 'cut', chop: 1, at: { hand: 0 } };
  p0.held = 'x1'; s.stats.spawned = 1;
  s.items['x2'] = { id: 'x2', kind: 'plate', dirty: false, contents: [], at: { hand: 1 } };
  p1.held = 'x2'; s.tiles['1,7'].clean -= 1;
  p0.x = 2.5; p0.y = 4.5; p0.fx = 1; p0.fy = 0;
  p1.x = 5.5; p1.y = 4.5; p1.fx = -1; p1.fy = 0;
  s = Game.step(s, { 0: { throw: true } }, DT);
  for (let i = 0; i < 12; i++) { s = Game.step(s, {}, DT); assert.deepStrictEqual(Game.checkInvariants(s), []); }
  assert.deepStrictEqual(s.items['x2'].contents, ['tomato:cut']);
  assert.ok(!s.items['x1']);
});

t('丟進檯面上的盤子', () => {
  let s = newGame('salad');
  s = at(s, 1, 6, 'S'); s = press(s, 'act');
  s = at(s, 3, 2, 'N'); s = press(s, 'act');                 // 盤子放 (3,1)
  s = chopOne(s, 2, 4);
  s = at(s, 3, 4, 'N'); s = press(s, 'throw'); s = wait(s, 0.6);
  assert.deepStrictEqual(s.items[s.tiles['3,1'].holds].contents, ['lettuce:cut']);
});

t('訂單不中斷：全部出完 2 秒內就有新訂單', () => {
  let s = newGame('tomato_soup');
  s = wait(s, Game.CFG.firstOrderSec + 0.1);
  s.orders = []; s.nextOrderIn = 30;                           // 模擬剛出完餐
  s = wait(s, Game.CFG.refillSec + 0.1);
  assert.strictEqual(s.orders.length, 1);
});

t('訂單不中斷：滿了的時候，一出餐空出位子就補', () => {
  let s = newGame('tomato_soup');
  s = wait(s, 80);                                             // 1 人：最多 2 張
  assert.strictEqual(s.orders.length, 2);
  s.orders.pop();
  s = wait(s, 0.2);
  assert.strictEqual(s.orders.length, 2, '應該馬上補上');
});

t('食材箱：上面放了東西就打不開，先拿走上面的', () => {
  let s = newGame('salad');
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 拿盤子
  s = at(s, 2, 2, 'N'); s = press(s, 'act');                 // 放在生菜箱上
  assert.ok(s.tiles['2,1'].holds, '盤子放在箱子上');
  s = press(s, 'act');                                       // 空手再按 → 拿起的是盤子，不是生菜
  assert.strictEqual(held(s).kind, 'plate');
  s = press(s, 'act'); s = press(s, 'act');                  // 放回去再拿一次也一樣
  assert.strictEqual(held(s).kind, 'plate');
  assert.strictEqual(s.stats.spawned, 0, '沒有拿出任何生菜');
});

t('食材箱：上面空的就能拿出食材', () => {
  let s = newGame('salad');
  s = at(s, 2, 2, 'N'); assert.strictEqual(Game.describe(s, 0).act, '拿生菜');
  s = press(s, 'act'); assert.strictEqual(held(s).name, 'lettuce');
});

t('髒盤整疊拿走，放進水槽一次全收', () => {
  let s = newGame('tomato_soup');
  s.tiles['2,7'].dirty = 3; s.tiles['1,7'].clean -= 3;
  s = at(s, 2, 6, 'S');
  assert.strictEqual(Game.describe(s, 0).act, '整疊拿走');
  s = press(s, 'act');
  assert.strictEqual(held(s).n, 3); assert.ok(held(s).dirty);
  assert.strictEqual(s.tiles['2,7'].dirty, 0);
  s = at(s, 8, 3, 'E'); s = press(s, 'act');
  assert.strictEqual(s.tiles['9,3'].dirty, 3);
  s = press(s, 'act'); s = wait(s, Game.CFG.washSec * 3 + 0.3);
  assert.strictEqual(s.items[s.tiles['9,4'].holds].n, 3, '三個洗好的疊在旁邊');
});

t('乾淨的一疊：一次拿一個，可以再疊回去', () => {
  let s = newGame('tomato_soup');
  s.tiles['1,7'].clean -= 3;
  s.items['x1'] = { id: 'x1', kind: 'plate', dirty: false, contents: [], n: 3, at: { tile: '3,1' } };
  s.tiles['3,1'].holds = 'x1';
  s = at(s, 3, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '拿盤子');
  s = press(s, 'act');
  assert.strictEqual(held(s).n, 1); assert.strictEqual(s.items['x1'].n, 2);
  assert.strictEqual(Game.describe(s, 0).act, '疊上去');
  s = press(s, 'act');
  assert.strictEqual(s.items['x1'].n, 3); assert.ok(!s.players[0].held);
});

t('一疊乾淨盤也可以放：切好的放在最上面，拿起來是那一個盤子連同菜', () => {
  let s = newGame('salad');
  s.tiles['1,7'].clean -= 2;
  s.items['x1'] = { id: 'x1', kind: 'plate', dirty: false, contents: [], n: 2, at: { tile: '3,1' } };
  s.tiles['3,1'].holds = 'x1';
  s = chopOne(s, 2, 4);
  s = at(s, 3, 2, 'N'); s = press(s, 'act');
  assert.deepStrictEqual(s.items['x1'].contents, ['lettuce:cut']);
  assert.ok(!s.players[0].held);
  s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['lettuce:cut']); assert.strictEqual(held(s).n, 1);
  assert.strictEqual(s.items['x1'].n, 1); assert.deepStrictEqual(s.items['x1'].contents, []);
});

t('生的食材不能放上盤子（單個或一疊都不行）', () => {
  let s = newGame('salad');
  s.tiles['1,7'].clean -= 2;
  s.items['x1'] = { id: 'x1', kind: 'plate', dirty: false, contents: [], n: 2, at: { tile: '3,1' } };
  s.tiles['3,1'].holds = 'x1';
  s = at(s, 2, 2, 'N'); s = press(s, 'act');                 // 生的生菜
  s = at(s, 3, 2, 'N'); s = press(s, 'act');
  assert.deepStrictEqual(s.items['x1'].contents, []);
  assert.strictEqual(held(s).state, 'raw');
});

t('燒焦：空盤可以把焦掉的接出來，再倒進垃圾桶', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: 99, burnt: true });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 空盤
  s = at(s, 7, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '把焦掉的接出來');
  s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['burnt']);
  assert.ok(!potAt(s, '7,1').burnt && !potAt(s, '7,1').contents.length, '鍋子空了，還在爐子上');
  s = at(s, 9, 6, 'S'); s = press(s, 'act');                 // 垃圾桶倒掉
  assert.deepStrictEqual(held(s).contents, []);
});

t('燒焦：拿著焦鍋對檯面上的空盤，也可以倒進去', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: 99, burnt: true });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 1, 6, 'S'); s = press(s, 'act');
  s = at(s, 3, 2, 'N'); s = press(s, 'act');                 // 空盤放 (3,1)
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 拿焦鍋
  s = at(s, 3, 2, 'N'); s = press(s, 'act');
  assert.deepStrictEqual(s.items[s.tiles['3,1'].holds].contents, ['burnt']);
  assert.ok(!held(s).burnt);
});

t('燒焦：盤子上有切好的食材時去接，什麼都不會發生（菜不會不見、鍋也不會被清掉）', () => {
  let s = newGame('salad'); s.dishes = ['salad', 'tomato_soup'];
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: 99, burnt: true });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 1, 6, 'S'); s = press(s, 'act');
  s = at(s, 3, 2, 'N'); s = press(s, 'act');
  s = chopOne(s, 2, 4); s = at(s, 3, 2, 'N'); s = press(s, 'act'); s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['lettuce:cut']);
  s = at(s, 7, 2, 'N'); s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['lettuce:cut'], '盤子上的生菜還在');
  assert.ok(potAt(s, '7,1').burnt, '焦鍋還在');
});

t('晾盤位被佔住時，洗好的盤子留在水槽邊，還是拿得到', () => {
  let s = newGame('tomato_soup');
  s.items['x9'] = { id: 'x9', kind: 'ing', name: 'tomato', state: 'raw', chop: 0, at: { tile: '9,4' } };
  s.tiles['9,4'].holds = 'x9'; s.stats.spawned = 1;
  s.tiles['9,3'].dirty = 1; s.tiles['1,7'].clean -= 1;
  s = at(s, 8, 3, 'E'); s = press(s, 'act'); s = wait(s, Game.CFG.washSec + 0.1);
  assert.strictEqual(s.tiles['9,3'].clean, 1);
  s = press(s, 'act');
  assert.ok(held(s) && held(s).kind === 'plate');
});

t('丟出是拋物線：中途有高度、約 4 格落地，落地後會停住', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 3, 4, 'E'); s = press(s, 'throw');
  const it0 = firstIng(s);
  let maxH = 0, landedX = null;
  for (let i = 0; i < 40; i++) {
    s = go(s, {});
    const it = s.items[it0.id];
    if (it.at.air) maxH = Math.max(maxH, it.at.air.h);
    if (it.at.floor && landedX === null) landedX = it.at.floor[0];
  }
  assert.ok(maxH > 1.0, '最高點應該超過 1 格高，實際 ' + maxH.toFixed(2));
  const dist = landedX - 3.5;
  assert.ok(dist > 3 && dist < 5.5, '落地距離約 4 格，實際 ' + dist.toFixed(2));
  const it = s.items[it0.id];
  assert.ok(it.at.floor && !it.at.slide, '最後要停住');
});

t('丟出撞牆會彈回來掉在地上，不會卡進牆裡', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 8, 5, 'E'); s = press(s, 'throw');               // 右邊兩格就是牆
  s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor, '應該在地上');
  assert.ok(it.at.floor[0] < 10, '在牆內側，x=' + it.at.floor[0].toFixed(2));
});

t('鍋子可以拿：煮好的整鍋端去倒進檯面上的盤子', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: Game.CFG.cookSec + 1, burnt: false });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 拿盤子
  s = at(s, 3, 2, 'N'); s = press(s, 'act');                 // 盤子放 (3,1)
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 拿起鍋子
  assert.strictEqual(held(s).kind, 'pot');
  s = at(s, 3, 2, 'N');
  assert.strictEqual(Game.describe(s, 0).act, '倒進盤子');
  s = press(s, 'act');
  assert.deepStrictEqual(s.items[s.tiles['3,1'].holds].contents, ['soup:tomato']);
  assert.deepStrictEqual(held(s).contents, [], '鍋子空了');
});

t('鍋子可以拿：拿著鍋子去砧板把切好的裝進去', () => {
  let s = newGame('tomato_soup');
  s = chopOne(s, 1, 4); s = at(s, 4, 2, 'N'); s = press(s, 'act');   // 切好的放回砧板
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 拿鍋
  s = at(s, 4, 2, 'N'); s = press(s, 'act');
  assert.deepStrictEqual(held(s).contents, ['tomato']);
  assert.ok(!s.tiles['4,1'].holds);
});

t('鍋子離開爐子就不會煮也不會焦，放回去接著煮', () => {
  let s = newGame('tomato_soup');
  Object.assign(potAt(s, '7,1'), { contents: ['tomato', 'tomato', 'tomato'], cook: 2, burnt: false });
  s.stats.spawned = 3; s.stats.merged = 3;
  s = at(s, 7, 2, 'N'); s = press(s, 'act');
  const pid = s.players[0].held;
  s = at(s, 3, 2, 'N'); s = press(s, 'act');                 // 放在檯面
  s = wait(s, 30);
  assert.ok(s.items[pid].cook < 2.1 && !s.items[pid].burnt, '檯面上不會煮');
  s = press(s, 'act'); s = at(s, 7, 2, 'N'); s = press(s, 'act');   // 放回爐子
  assert.strictEqual(s.tiles['7,1'].holds, pid);
  s = wait(s, Game.CFG.cookSec);
  assert.ok(Game.potReady(s.items[pid]));
});

t('爐子等同平台：盤子、食材都能放上去，但只有鍋子會煮', () => {
  let s = newGame('tomato_soup');
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 拿起鍋，爐子 (7,1) 空了
  s = at(s, 4, 2, 'N'); s = press(s, 'act');                 // 鍋子不能放砧板
  assert.strictEqual(held(s).kind, 'pot');
  s = at(s, 3, 2, 'N'); s = press(s, 'act');                 // 鍋子先放檯面
  s = at(s, 1, 2, 'N'); s = press(s, 'act');                 // 拿生番茄
  s = at(s, 7, 2, 'N'); s.players[0].fx = 0; s = press(s, 'act');   // 放上空爐子
  const it = s.items[s.tiles['7,1'].holds];
  assert.ok(it && it.kind === 'ing', '番茄放在爐子上');
  s = wait(s, 20);
  assert.strictEqual(it.state, 'raw'); assert.strictEqual(s.items[it.id].state, 'raw', '不會被煮');
  s = press(s, 'act');                                       // 拿回來
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 放不上盤架（拿著食材）→ 換個方式：丟垃圾桶
  s = at(s, 9, 6, 'S'); s = press(s, 'act');
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 拿盤子
  s = at(s, 7, 2, 'N'); s.players[0].fx = 0; s = press(s, 'act');   // 盤子也能放上爐子
  assert.strictEqual(s.items[s.tiles['7,1'].holds].kind, 'plate');
});

t('鍋子不能丟', () => {
  let s = newGame('tomato_soup');
  s = at(s, 7, 2, 'N'); s = press(s, 'act'); s = press(s, 'throw');
  assert.strictEqual(held(s).kind, 'pot');
});

t('自動瞄準：對著牆丟，會自動對準旁邊能越過的檯面', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 4, 4, 'E'); s = press(s, 'throw');               // 正前方 (6,4) 是普通牆，旁邊 (6,3)(6,5) 是傳菜檯面
  s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor && it.at.floor[0] > 7, '自動越過檯面到右邊，x=' + (it.at.floor && it.at.floor[0].toFixed(2)));
});

t('斜著丟：越過中間那排檯面，或落在中間檯面上（兩邊都拿得到）', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 4, 6, 'E'); s.players[0].fx = 0.8; s.players[0].fy = -0.6;   // 斜右上
  s = press(s, 'throw'); s = wait(s, 1.5);
  const it = firstIng(s);
  const onMiddle = it.at.tile && it.at.tile.split(',')[0] === '6';
  const right = it.at.floor && it.at.floor[0] > 7;
  assert.ok(onMiddle || right, JSON.stringify(it.at));
});

t('自動瞄準：照面向丟本來就沒問題時不修正方向', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 3, 4, 'E'); s = press(s, 'throw');
  assert.strictEqual(s.players[0].fx, 1); assert.strictEqual(s.players[0].fy, 0);
});

t('普通牆：附近沒有能越過的目標時，丟出的東西會被擋回來', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 8, 5, 'E'); s = press(s, 'throw'); s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor && it.at.floor[0] < 10);
});

t('自動瞄準：直丟沒問題時，就算旁邊有隊友也不轉向', () => {
  let s = Game.createGame(L11, 2, 1);
  s = JSON.parse(JSON.stringify(s));
  s.items['x1'] = { id: 'x1', kind: 'ing', name: 'tomato', state: 'raw', chop: 0, at: { hand: 0 } };
  s.players[0].held = 'x1'; s.stats.spawned = 1;
  Object.assign(s.players[0], { x: 3.5, y: 4.5, fx: 1, fy: 0 });
  Object.assign(s.players[1], { x: 6.5, y: 3.0 });          // 右前方約 27°
  s = Game.step(s, { 0: { throw: true } }, DT);
  assert.strictEqual(s.players[0].fx, 1);
});

t('隔牆：中間的牆丟得過去，落在另一邊', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 4, 2, 'E'); s = press(s, 'throw');               // (6,2) 是中間的牆，後面 (7,2) 是地板
  s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor && it.at.floor[0] > 7, '越過隔牆，x=' + (it.at.floor && it.at.floor[0].toFixed(2)));
  assert.strictEqual(s.players[0].fx, 1, '直丟就過得去，不用轉向');
});

t('外牆：一定擋住', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 2, 4, 'W'); s = press(s, 'throw');               // 左邊是外牆
  s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor && it.at.floor[0] > 1 && it.at.floor[0] < 3);
});

t('衝刺：朝面向衝出約 2 格，冷卻中不能再衝', () => {
  let s = newGame('tomato_soup');
  s = at(s, 2, 4, 'E');
  const x0 = s.players[0].x;
  s = go(s, { dash: true }); s = wait(s, 0.3);
  const d1 = s.players[0].x - x0;
  assert.ok(d1 > 1.6 && d1 < 2.8, '衝了約 2 格，實際 ' + d1.toFixed(2));
  const x1 = s.players[0].x;
  s = go(s, { dash: true }); s = wait(s, 0.1);
  assert.ok(s.players[0].x - x1 < 0.1, '冷卻中不能再衝');
  s = wait(s, Game.CFG.dashCooldown);
  s = go(s, { dash: true }); s = wait(s, 0.3);
  assert.ok(s.players[0].x - x1 > 1, '冷卻完可以再衝');
});

t('衝刺撞牆會停住，不會穿牆', () => {
  let s = newGame('tomato_soup');
  s = at(s, 8, 5, 'E');
  s = go(s, { dash: true }); s = wait(s, 0.4);
  assert.ok(s.players[0].x < 10 - Game.CFG.radius + 0.01, 'x=' + s.players[0].x.toFixed(2));
});

t('越過檯面：檯面後面不是牆，丟出的東西飛過去落到另一邊', () => {
  let s = Game.createGame(L12, 1, 1);
  s = at(s, 2, 2, 'N'); s = press(s, 'act');
  s = at(s, 4, 3, 'E'); s = press(s, 'throw');               // (6,3) 是中間的傳菜檯面，後面 (7,3) 是地板
  s = wait(s, 1.5);
  const it = firstIng(s);
  assert.ok(it.at.floor && it.at.floor[0] > 7, '越過檯面到右邊');
  assert.ok(!s.tiles['6,3'].holds);
});

t('檯面後面是牆：丟出的東西落在檯面上', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 3, 4, 'N'); s = press(s, 'throw');               // (3,1) 檯面，後面 (3,0) 是牆
  s = wait(s, 1.5);
  assert.ok(s.tiles['3,1'].holds, '落在檯面上');
  assert.strictEqual(s.items[s.tiles['3,1'].holds].name, 'tomato');
});

t('地上的盤子：可以把切好的放上去、可以疊、可以撿起來', () => {
  let s = newGame('salad');
  s = at(s, 1, 6, 'S'); s = press(s, 'act');                 // 拿盤子
  s = at(s, 5, 4, 'E'); s = press(s, 'act');                 // 面向地板 → 放在地上
  const pid = Object.values(s.items).find((i) => i.kind === 'plate').id;
  assert.ok(s.items[pid].at.floor, '盤子在地上');
  s = chopOne(s, 2, 4);
  s = at(s, 5, 4, 'E');
  assert.strictEqual(Game.describe(s, 0).act, '裝盤');
  s = press(s, 'act');
  assert.deepStrictEqual(s.items[pid].contents, ['lettuce:cut'], '裝到地上的盤子');
  s = press(s, 'act');                                       // 空手 → 撿起來
  assert.strictEqual(s.players[0].held, pid);
});

t('面對地板、旁邊的工作台都放不下時，東西可以放在地上', () => {
  let s = newGame('tomato_soup');
  s.items['x7'] = { id: 'x7', kind: 'plate', dirty: false, contents: [], n: 1, at: { tile: '6,1' } };
  s.tiles['6,1'].holds = 'x7'; s.tiles['1,7'].clean -= 1;     // (6,1) 檯面上放盤子（不收生番茄）
  s = at(s, 1, 2, 'N'); s = press(s, 'act');                 // 生番茄
  s = at(s, 6, 2, 'E'); s = press(s, 'act');                 // 旁邊有鍋、有盤子都不收，面前 (7,2) 是地板
  const tomato = Object.values(s.items).find((i) => i.name === 'tomato');
  assert.ok(tomato.at.floor, '放在地上');
});

t('面對放不下的工作台時，東西留在手上不會掉地上', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'act');                 // 生番茄
  s = at(s, 7, 2, 'N'); s = press(s, 'act');                 // 對著鍋（不收生的）
  assert.ok(held(s) && held(s).name === 'tomato');
});

t('滑進牆角：停下來時跟牆、檯面保持距離，不會卡進角落', () => {
  let s = newGame('tomato_soup');
  s.items['x1'] = { id: 'x1', kind: 'ing', name: 'tomato', state: 'raw', chop: 0, at: { floor: [8.8, 5.8], slide: { vx: 6, vy: 6 } } };
  s.stats.spawned = 1;                                         // 朝右下角 (9,6) 滑：右邊是牆、下面是檯面
  s = wait(s, 1);
  const [x, y] = s.items['x1'].at.floor, r = Game.CFG.itemRadius - 0.01;
  assert.ok(x <= 10 - r && y <= 7 - r, '離牆角夠遠：' + x.toFixed(2) + ',' + y.toFixed(2));
});

t('丟到已經有東西的檯面：滑到旁邊空的檯面，不會疊在同一格', () => {
  let s = newGame('tomato_soup');
  s.items['x5'] = { id: 'x5', kind: 'ing', name: 'lettuce', state: 'raw', chop: 0, at: { tile: '3,1' } };
  s.tiles['3,1'].holds = 'x5'; s.stats.spawned = 1;
  s = at(s, 1, 2, 'N'); s = press(s, 'grab');
  s = at(s, 3, 4, 'N'); s = press(s, 'throw');               // (3,1) 有生菜，後面是外牆
  s = wait(s, 1.5);
  const tomato = Object.values(s.items).find((i) => i.name === 'tomato');
  assert.ok(tomato.at.tile && tomato.at.tile !== '3,1', '落到旁邊的檯面：' + JSON.stringify(tomato.at));
  assert.strictEqual(s.tiles['3,1'].holds, 'x5');
});

t('地上的東西不會疊在同一點', () => {
  let s = newGame('tomato_soup');
  s.items['x1'] = { id: 'x1', kind: 'ing', name: 'tomato', state: 'raw', chop: 0, at: { floor: [5.5, 4.5] } };
  s.items['x2'] = { id: 'x2', kind: 'ing', name: 'lettuce', state: 'raw', chop: 0, at: { floor: [4.0, 4.5], slide: { vx: 5, vy: 0 } } };
  s.stats.spawned = 2;
  s = wait(s, 1);
  const a = s.items['x1'].at.floor, b = s.items['x2'].at.floor;
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= Game.CFG.itemRadius * 1.7, '分開：' + a + ' / ' + b);
});

t('晾盤架只放乾淨的空盤', () => {
  let s = newGame('tomato_soup');
  s = at(s, 1, 2, 'N'); s = press(s, 'act');                 // 番茄
  s = at(s, 8, 4, 'E'); s = press(s, 'act');                 // (9,4) 晾盤架放不了番茄
  assert.ok(held(s) && held(s).name === 'tomato');
  assert.ok(!s.tiles['9,4'].holds);
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

t('突變：鍋子憑空消失 → 守恆檢查報錯', () => {
  let s = newGame('tomato_soup'); delete s.items[s.tiles['7,1'].holds]; s.tiles['7,1'].holds = null;
  assert.ok(Game.checkInvariants(s).some((e) => /鍋子/.test(e)));
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
