// node tests/level.test.js
const assert = require('assert');
const Level = require('../shared/level.js');
const levels = require('../data/levels.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
}

// 內建 5 關都要通過
levels.forEach((lv) => t(lv.id + ' ' + lv.name + ' 沒有錯誤', () => {
  const r = Level.validate(lv);
  assert.deepStrictEqual(r.errors, [], r.errors.join(' / '));
  if (r.warnings.length) console.log('      提醒：', r.warnings.join(' / '));
}));

t('檢查不會改到傳入的關卡', () => {
  const lv = clone(levels[4]); const before = JSON.stringify(lv);
  Level.validate(lv); Level.resolve(lv, 1); Level.resolve(lv, 8);
  assert.strictEqual(JSON.stringify(lv), before);
});

t('依人數展開：5 人以上才出現的爐子，4 人時變檯面', () => {
  const lv = levels[0];
  assert.strictEqual(Level.resolve(lv, 4).cells[4][9], 'C');
  assert.strictEqual(Level.resolve(lv, 5).cells[4][9], 'S');
});

t('依人數展開：1 人時牆變門，2 人時還是牆', () => {
  const lv = levels[1];
  assert.strictEqual(Level.resolve(lv, 1).cells[8][6], '.');
  assert.strictEqual(Level.resolve(lv, 2).cells[8][6], '#');
});

t('只取前 n 個出生點', () => {
  assert.strictEqual(Level.resolve(levels[1], 3).spawns.length, 3);
});

// 突變：拿掉關鍵東西，檢查一定要報錯
t('突變：拿掉 1 人門 → 1 人時走不到爐子', () => {
  const lv = clone(levels[1]); delete lv.props['6,8'];
  const e = Level.validate(lv).errors.join();
  assert.ok(/1 人：走不到/.test(e), e);
});

t('突變：拿掉盤架 → 報錯', () => {
  const lv = clone(levels[0]); lv.grid[7] = lv.grid[7].replace('P', 'C');
  assert.ok(Level.validate(lv).errors.some((m) => /盤架/.test(m)));
});

t('突變：菜單加蘑菇湯但沒有蘑菇箱 → 報錯', () => {
  const lv = clone(levels[0]); lv.dishes.push('mushroom_soup');
  assert.ok(Level.validate(lv).errors.some((m) => /蘑菇/.test(m)));
});

t('突變：把傳菜檯面全改成牆 → 區域之間傳不了東西', () => {
  const lv = clone(levels[1]);
  lv.grid = lv.grid.map((row, y) => (y >= 1 && y <= 8) ? row.slice(0, 6) + '#' + row.slice(7) : row);
  const e = Level.validate(lv).errors.join();
  assert.ok(/傳不了東西/.test(e), e);
});

t('突變：移動檯面路線壓到牆 → 報錯', () => {
  const lv = clone(levels[3]); lv.props['5,3'].len = 5;
  assert.ok(Level.validate(lv).errors.some((m) => /路線/.test(m)));
});

t('突變：只放 7 個出生點 → 報錯', () => {
  const lv = clone(levels[0]); lv.spawns.pop();
  assert.ok(Level.validate(lv).errors.some((m) => /8 個出生點/.test(m)));
});

t('突變：輸送帶沒有方向 → 報錯', () => {
  const lv = clone(levels[2]); delete lv.props['6,3'].dir;
  assert.ok(Level.validate(lv).errors.some((m) => /輸送帶/.test(m)));
});

t('突變：星等分數不是由小到大 → 報錯', () => {
  const lv = clone(levels[0]); lv.stars = [300, 200, 500];
  assert.ok(Level.validate(lv).errors.some((m) => /星/.test(m)));
});

t('人數星等換算：8 人門檻比 4 人高', () => {
  const s4 = Level.starsFor(levels[4], 4), s8 = Level.starsFor(levels[4], 8);
  assert.ok(s8[2] > s4[2]);
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
