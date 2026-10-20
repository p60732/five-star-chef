// 五星大主廚 規則引擎（純函式）
// createGame(level, n, seed) → state；step(state, inputs, dt) → 新 state
// 不碰 DOM、不碰網路、不讀現在時間；不修改傳入的 state（每次回傳新物件）。
// 伺服器判定與前端預測共用這一份。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../level.js'));
  else root.Game = factory(root.Level);
})(typeof self !== 'undefined' ? self : this, function (Level) {
  'use strict';

  // ── 可調數字（第一版預設值，試玩後再調）──
  var CFG = {
    speed: 4.2,            // 格/秒
    radius: 0.32,          // 角色碰撞半徑（格）
    chopSec: 2.0,          // 切一次要按住幾秒
    washSec: 2.5,          // 洗一個盤子
    cookSec: 8,            // 煮熟
    burnSec: 10,           // 煮熟後再過幾秒燒焦
    soupSize: 3,           // 湯要幾份食材
    plates: 4,             // 開局盤子數
    returnSec: 6,          // 出餐後幾秒髒盤回來
    throwSpeed: 9,         // 丟出速度（格/秒）
    throwRange: 4,         // 最遠幾格
    tipMax: 20,            // 小費上限
    expirePenalty: 20,     // 訂單逾時扣分
    patience: { salad: 50, tomato_soup: 70, onion_soup: 70, mushroom_soup: 70, tomato_noodle: 80 },
    firstOrderSec: 2
  };

  var CHOPPABLE = { tomato: 1, lettuce: 1, onion: 1, mushroom: 1 };
  var SOUP_OK = { tomato: 1, onion: 1, mushroom: 1 };
  // 每道菜裝盤後要的內容（排序後比對）
  var SIGNATURE = {
    salad: ['lettuce:cut', 'tomato:cut'],
    tomato_soup: ['soup:tomato'],
    onion_soup: ['soup:onion'],
    mushroom_soup: ['soup:mushroom'],
    tomato_noodle: ['noodle:cooked', 'tomato:cut']
  };
  var DIR4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var HOLD_TILES = { C: 1, B: 1, V: 1, M: 1, W: 1 };   // 能放東西的格子

  function key(x, y) { return x + ',' + y; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 帶種子的亂數（mulberry32），狀態存在 state.rng
  function rand(state) {
    var t = (state.rng = (state.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── 開局 ──
  function createGame(level, n, seed) {
    var r = Level.resolve(level, n);
    var cells = r.cells.map(function (row) { return row.join(''); });
    var props = level.props || {};
    var tiles = {}, firstRack = null, returns = [];
    cells.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x], k = key(x, y);
        if (HOLD_TILES[ch]) tiles[k] = { holds: null };
        if (ch === 'B') tiles[k] = { holds: null };
        if (ch === 'S') tiles[k] = { pot: { contents: [], cook: 0, burnt: false } };
        if (ch === 'P') { tiles[k] = { clean: 0 }; if (!firstRack) firstRack = k; }
        if (ch === 'R') { tiles[k] = { dirty: 0 }; returns.push(k); }
        if (ch === 'K') tiles[k] = { dirty: 0, wash: 0 };
        if (ch === 'I') tiles[k] = { item: (props[k] || {}).item };
      }
    });
    if (firstRack) tiles[firstRack].clean = level.plates || CFG.plates;
    var players = r.spawns.map(function (s, i) {
      return { id: i, x: s[0] + 0.5, y: s[1] + 0.5, fx: 0, fy: -1, held: null, busy: null };
    });
    return {
      v: 1,
      levelId: level.id, n: n,
      w: cells[0].length, h: cells.length, cells: cells,
      timeLeft: level.timeSec, total: level.timeSec, elapsed: 0, ended: false,
      dishes: (level.dishes || []).slice(),
      difficulty: Level.DIFFICULTY[n],
      stars: Level.starsFor(level, n),
      rng: (seed >>> 0) || 1,
      players: players,
      items: {}, nextId: 1,
      tiles: tiles, rack: firstRack, returns: returns,
      pendingReturn: [],          // 出餐後等著回來的盤子：[秒數]
      orders: [], nextOrderIn: CFG.firstOrderSec, nextOrderId: 1,
      score: 0,
      stats: { served: 0, failed: 0, base: 0, tips: 0, penalty: 0, spawned: 0, trashed: 0, merged: 0, totalPlates: firstRack ? (level.plates || CFG.plates) : 0 },
      events: []
    };
  }

  // ── 查詢 ──
  function cellAt(s, x, y) {
    if (y < 0 || y >= s.h || x < 0 || x >= s.w) return '#';
    return s.cells[y][x];
  }
  function walkable(s, x, y) { return cellAt(s, x, y) === '.'; }
  function facingCell(p) {
    var cx = Math.floor(p.x), cy = Math.floor(p.y);
    if (Math.abs(p.fx) >= Math.abs(p.fy)) return [cx + (p.fx >= 0 ? 1 : -1), cy];
    return [cx, cy + (p.fy >= 0 ? 1 : -1)];
  }
  function newItem(s, data) {
    var id = 'i' + s.nextId++;
    data.id = id; s.items[id] = data; return data;
  }
  function removeItem(s, id) { delete s.items[id]; }
  function isPlate(it) { return it && it.kind === 'plate'; }
  function isIng(it) { return it && it.kind === 'ing'; }

  // 這個盤子加上 add 之後，還有沒有可能湊成本關的某道菜
  function plateCanTake(s, plate, add) {
    if (plate.dirty) return false;
    if (plate.contents.indexOf(add) >= 0) return false;
    var next = plate.contents.concat([add]);
    return s.dishes.some(function (d) {
      var sig = SIGNATURE[d];
      return sig && next.every(function (c) { return sig.indexOf(c) >= 0; });
    });
  }
  function ingTag(it) { return it.name + ':' + it.state; }

  function potAccepts(pot, it) {
    if (!isIng(it) || pot.burnt) return false;
    var c = pot.contents;
    if (it.name === 'noodle') return it.state === 'raw' && c.length === 0;
    if (!SOUP_OK[it.name] || it.state !== 'cut') return false;
    if (c.length >= CFG.soupSize) return false;
    return c.every(function (n) { return n === it.name; });
  }
  function potComplete(pot) {
    var c = pot.contents;
    return (c.length === 1 && c[0] === 'noodle') || c.length === CFG.soupSize;
  }
  function potReady(pot) { return potComplete(pot) && !pot.burnt && pot.cook >= CFG.cookSec; }
  function potOutput(pot) { return pot.contents[0] === 'noodle' ? 'noodle:cooked' : 'soup:' + pot.contents[0]; }
  function putInPot(s, pot, it) {
    pot.contents.push(it.name); removeItem(s, it.id); s.stats.merged++;
  }

  // ── 拿 / 放 ──
  function grab(s, p) {
    var fc = facingCell(p), fk = key(fc[0], fc[1]), ch = cellAt(s, fc[0], fc[1]), t = s.tiles[fk];
    var held = p.held ? s.items[p.held] : null;

    if (!held) {
      if (t && t.holds) { var it = s.items[t.holds]; t.holds = null; it.at = { hand: p.id }; p.held = it.id; return 'pick'; }
      if (ch === 'I' && t.item) {
        var ni = newItem(s, { kind: 'ing', name: t.item, state: 'raw', chop: 0, at: { hand: p.id } });
        p.held = ni.id; s.stats.spawned++; return 'crate';
      }
      if (ch === 'P' && t.clean > 0) { t.clean--; p.held = newItem(s, { kind: 'plate', dirty: false, contents: [], at: { hand: p.id } }).id; return 'plate'; }
      if (ch === 'R' && t.dirty > 0) { t.dirty--; p.held = newItem(s, { kind: 'plate', dirty: true, contents: [], at: { hand: p.id } }).id; return 'dirty'; }
      // 地上的東西
      var fl = floorItemNear(s, p);
      if (fl) { fl.at = { hand: p.id }; p.held = fl.id; return 'pickFloor'; }
      return null;
    }

    // 手上有東西
    if (t && 'holds' in t) {
      var on = t.holds ? s.items[t.holds] : null;
      if (!on) {
        if (ch === 'B' && !isIng(held)) return null;           // 砧板只放食材
        t.holds = held.id; held.at = { tile: fk }; p.held = null; return 'place';
      }
      if (isPlate(on) && isIng(held) && plateCanTake(s, on, ingTag(held))) {
        on.contents.push(ingTag(held)); removeItem(s, held.id); p.held = null; s.stats.merged++; return 'toPlate';
      }
      if (isPlate(held) && isIng(on) && plateCanTake(s, held, ingTag(on))) {
        held.contents.push(ingTag(on)); removeItem(s, on.id); t.holds = null; s.stats.merged++; return 'toPlate';
      }
      return null;
    }
    if (ch === 'S') {
      var pot = t.pot;
      if (potAccepts(pot, held)) { putInPot(s, pot, held); p.held = null; return 'toPot'; }
      if (isPlate(held) && potReady(pot) && plateCanTake(s, held, potOutput(pot))) {
        held.contents.push(potOutput(pot)); pot.contents = []; pot.cook = 0; return 'fromPot';
      }
      return null;
    }
    if (ch === 'O') return serve(s, p, held);
    if (ch === 'T') {
      if (isIng(held)) { removeItem(s, held.id); p.held = null; s.stats.trashed++; return 'trash'; }
      if (isPlate(held) && held.contents.length) { held.contents = []; return 'trashPlate'; }
      return null;
    }
    if (ch === 'K' && isPlate(held) && held.dirty) { t.dirty++; removeItem(s, held.id); p.held = null; return 'toSink'; }
    if (ch === 'P' && isPlate(held) && !held.dirty && !held.contents.length) { t.clean++; removeItem(s, held.id); p.held = null; return 'toRack'; }
    if (walkable(s, fc[0], fc[1])) {             // 放在面前的地上
      held.at = { floor: [fc[0] + 0.5, fc[1] + 0.5] }; p.held = null; return 'drop';
    }
    return null;
  }

  function floorItemNear(s, p) {
    var px = p.x + p.fx * 0.6, py = p.y + p.fy * 0.6, best = null, bd = 0.85;
    for (var id in s.items) {
      var it = s.items[id];
      if (!it.at.floor) continue;
      var d = Math.hypot(it.at.floor[0] - px, it.at.floor[1] - py);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  function serve(s, p, held) {
    if (!isPlate(held) || held.dirty || !held.contents.length) return null;
    var got = held.contents.slice().sort().join('|');
    var idx = -1;
    for (var i = 0; i < s.orders.length; i++) {
      if (SIGNATURE[s.orders[i].dish].slice().sort().join('|') === got) { idx = i; break; }
    }
    if (idx < 0) { s.events.push({ t: 'wrong', pid: p.id }); return null; }
    var o = s.orders[idx], dish = Level.DISHES[o.dish];
    var tip = Math.round(CFG.tipMax * o.timeLeft / o.total);
    s.score += dish.score + tip;
    s.stats.served++; s.stats.base += dish.score; s.stats.tips += tip;
    s.orders.splice(idx, 1);
    removeItem(s, held.id); p.held = null;
    s.pendingReturn.push(CFG.returnSec);
    s.events.push({ t: 'served', pid: p.id, dish: o.dish, points: dish.score + tip });
    return 'serve';
  }

  // ── 丟出 ──
  function throwItem(s, p) {
    var held = p.held ? s.items[p.held] : null;
    if (!isIng(held)) return null;                      // 只能丟食材（盤子不能丟）
    var len = Math.hypot(p.fx, p.fy) || 1;
    held.at = { air: { x: p.x, y: p.y, vx: p.fx / len * CFG.throwSpeed, vy: p.fy / len * CFG.throwSpeed, dist: 0, by: p.id } };
    p.held = null; return 'throw';
  }

  function flyItems(s, dt) {
    for (var id in s.items) {
      var it = s.items[id], a = it.at.air;
      if (!a) continue;
      var steps = 4, sdt = dt / steps;
      for (var k = 0; k < steps && it.at.air; k++) {
        var px = a.x, py = a.y;
        a.x += a.vx * sdt; a.y += a.vy * sdt; a.dist += CFG.throwSpeed * sdt;
        var cx = Math.floor(a.x), cy = Math.floor(a.y), ch = cellAt(s, cx, cy), ck = key(cx, cy);
        // 隊友接住
        var catcher = s.players.find(function (q) {
          return q.id !== a.by && !q.held && Math.hypot(q.x - a.x, q.y - a.y) < 0.55;
        });
        if (catcher) { it.at = { hand: catcher.id }; catcher.held = it.id; s.events.push({ t: 'catch', pid: catcher.id }); break; }
        if (ch === '.' || ch === ' ') {
          if (a.dist >= CFG.throwRange) { land(s, it, a.x, a.y, px, py); break; }
          continue;
        }
        // 撞到格子
        var t = s.tiles[ck];
        if (ch === 'S' && potAccepts(t.pot, it)) { putInPot(s, t.pot, it); s.events.push({ t: 'potIn' }); break; }
        if (ch === 'T') { removeItem(s, it.id); s.stats.trashed++; break; }
        if (t && 'holds' in t && !t.holds) { t.holds = it.id; it.at = { tile: ck }; break; }
        land(s, it, px, py, px, py); break;           // 牆或放不下：掉在前一格
      }
    }
  }
  function land(s, it, x, y, px, py) {
    var cx = Math.floor(x), cy = Math.floor(y);
    if (!walkable(s, cx, cy)) { cx = Math.floor(px); cy = Math.floor(py); }
    if (!walkable(s, cx, cy)) {                          // 還是不行就找最近的地板
      var best = null, bd = 1e9;
      for (var yy = 0; yy < s.h; yy++) for (var xx = 0; xx < s.w; xx++) {
        if (!walkable(s, xx, yy)) continue;
        var d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
        if (d < bd) { bd = d; best = [xx, yy]; }
      }
      cx = best[0]; cy = best[1];
    }
    it.at = { floor: [cx + 0.5, cy + 0.5] };
  }

  // ── 切 / 洗 / 清鍋（按住）──
  function useHeld(s, p, dt) {
    var fc = facingCell(p), fk = key(fc[0], fc[1]), ch = cellAt(s, fc[0], fc[1]), t = s.tiles[fk];
    if (ch === 'B' && !p.held && t.holds) {
      var it = s.items[t.holds];
      if (isIng(it) && it.state === 'raw' && CHOPPABLE[it.name]) {
        it.chop = Math.min(1, it.chop + dt / CFG.chopSec);
        p.busy = 'chop';
        if (it.chop >= 1) { it.state = 'cut'; p.busy = null; s.events.push({ t: 'chopped', pid: p.id }); }
        return;
      }
    }
    if (ch === 'K' && !p.held && t.dirty > 0 && s.rack) {
      t.wash += dt / CFG.washSec; p.busy = 'wash';
      if (t.wash >= 1) { t.wash = 0; t.dirty--; s.tiles[s.rack].clean++; p.busy = null; s.events.push({ t: 'washed', pid: p.id }); }
      return;
    }
    if (ch === 'S' && t.pot.burnt) {
      t.pot = { contents: [], cook: 0, burnt: false }; s.events.push({ t: 'cleared', pid: p.id }); p.busy = null; return;
    }
    p.busy = null;
  }

  // ── 移動 ──
  function move(s, p, mx, my, dt) {
    var len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; len = 1; }
    if (len > 0.2) { p.fx = mx / len; p.fy = my / len; }
    if (len < 0.05) return;
    var nx = p.x + mx * CFG.speed * dt, ny = p.y + my * CFG.speed * dt;
    if (!blocked(s, nx, p.y)) p.x = nx;
    if (!blocked(s, p.x, ny)) p.y = ny;
  }
  function blocked(s, x, y) {
    var r = CFG.radius;
    for (var yy = Math.floor(y - r); yy <= Math.floor(y + r); yy++) {
      for (var xx = Math.floor(x - r); xx <= Math.floor(x + r); xx++) {
        if (walkable(s, xx, yy)) continue;
        // 圓與方格是否相交
        var qx = Math.max(xx, Math.min(x, xx + 1)), qy = Math.max(yy, Math.min(y, yy + 1));
        if (Math.hypot(x - qx, y - qy) < r) return true;
      }
    }
    return false;
  }

  // ── 訂單 ──
  function tickOrders(s, dt) {
    for (var i = s.orders.length - 1; i >= 0; i--) {
      var o = s.orders[i];
      o.timeLeft -= dt;
      if (o.timeLeft <= 0) {
        s.orders.splice(i, 1); s.score -= CFG.expirePenalty;
        s.stats.failed++; s.stats.penalty += CFG.expirePenalty;
        s.events.push({ t: 'expired', dish: o.dish });
      }
    }
    s.nextOrderIn -= dt;
    if (s.nextOrderIn <= 0) {
      if (s.orders.length < s.difficulty.maxOrders && s.dishes.length) {
        var dish = s.dishes[Math.floor(rand(s) * s.dishes.length)];
        var pat = CFG.patience[dish] || 60;
        s.orders.push({ id: s.nextOrderId++, dish: dish, timeLeft: pat, total: pat });
        s.events.push({ t: 'order', dish: dish });
      }
      s.nextOrderIn = s.difficulty.orderEverySec;
    }
  }

  // ── 一個 tick ──
  // inputs[pid] = { mx, my, grab: bool（這一刻按下）, throw: bool, use: bool（按住中）}
  function step(prev, inputs, dt) {
    var s = clone(prev);
    s.events = [];
    if (s.ended) return s;
    inputs = inputs || {};

    s.players.forEach(function (p) {
      var inp = inputs[p.id] || {};
      var moving = Math.hypot(inp.mx || 0, inp.my || 0) > 0.1;
      move(s, p, inp.mx || 0, inp.my || 0, dt);
      if (inp.grab) { var r = grab(s, p); s.events.push({ t: r ? 'grab:' + r : 'nothing', pid: p.id }); }
      if (inp['throw']) { var r2 = throwItem(s, p); if (r2) s.events.push({ t: 'throw', pid: p.id }); }
      if (inp.use && !moving) useHeld(s, p, dt); else p.busy = null;
    });

    flyItems(s, dt);

    // 爐子
    for (var k in s.tiles) {
      var pot = s.tiles[k].pot;
      if (!pot || !potComplete(pot) || pot.burnt) continue;
      pot.cook += dt;
      if (pot.cook >= CFG.cookSec + CFG.burnSec) { pot.burnt = true; s.events.push({ t: 'burnt', tile: k }); }
    }

    // 髒盤回來
    for (var i = s.pendingReturn.length - 1; i >= 0; i--) {
      s.pendingReturn[i] -= dt;
      if (s.pendingReturn[i] <= 0) {
        s.pendingReturn.splice(i, 1);
        if (s.returns.length) s.tiles[s.returns[0]].dirty++;
        else if (s.rack) s.tiles[s.rack].clean++;
        s.events.push({ t: 'plateBack' });
      }
    }

    tickOrders(s, dt);

    s.elapsed += dt;
    s.timeLeft = Math.max(0, s.total - s.elapsed);
    if (s.timeLeft <= 0) { s.ended = true; s.events.push({ t: 'end' }); }
    return s;
  }

  // ── 守恆檢查（測試與 debug 用）──
  function plateCount(s) {
    var n = s.pendingReturn.length;
    for (var id in s.items) if (isPlate(s.items[id])) n++;
    for (var k in s.tiles) { var t = s.tiles[k]; n += (t.clean || 0) + (t.dirty || 0); }
    return n;
  }
  function ingCount(s) {
    var n = 0;
    for (var id in s.items) if (isIng(s.items[id])) n++;
    return n;
  }
  function checkInvariants(s) {
    var errs = [];
    if (plateCount(s) !== s.stats.totalPlates) errs.push('盤子數不守恆：' + plateCount(s) + ' ≠ ' + s.stats.totalPlates);
    var expect = s.stats.spawned - s.stats.trashed - s.stats.merged;
    if (ingCount(s) !== expect) errs.push('食材數不守恆：' + ingCount(s) + ' ≠ ' + expect);
    var sc = s.stats.base + s.stats.tips - s.stats.penalty;
    if (s.score !== sc) errs.push('分數不守恆：' + s.score + ' ≠ ' + sc);
    // 每個東西只在一個地方
    var seen = {};
    s.players.forEach(function (p) { if (p.held) { if (!s.items[p.held]) errs.push('手上的東西不存在'); seen[p.held] = (seen[p.held] || 0) + 1; } });
    for (var k in s.tiles) if (s.tiles[k].holds) { if (!s.items[s.tiles[k].holds]) errs.push('檯面上的東西不存在'); seen[s.tiles[k].holds] = (seen[s.tiles[k].holds] || 0) + 1; }
    for (var id in s.items) {
      var at = s.items[id].at;
      if (at.hand != null || at.tile) { if (seen[id] !== 1) errs.push(id + ' 位置不一致'); }
    }
    return errs;
  }

  // ── 提示：面前是什麼、按鍵會做什麼（給畫面用）──
  var NAMES = { tomato: '番茄', lettuce: '生菜', onion: '洋蔥', mushroom: '蘑菇', noodle: '麵' };
  function itemLabel(it) {
    if (!it) return '';
    if (isPlate(it)) {
      if (it.dirty) return '髒盤子';
      if (!it.contents.length) return '空盤子';
      return '盤子（' + it.contents.map(contentLabel).join('＋') + '）';
    }
    return (it.state === 'cut' ? '切好的' : '') + NAMES[it.name];
  }
  function contentLabel(c) {
    var a = c.split(':');
    if (a[0] === 'soup') return NAMES[a[1]] + '湯';
    if (a[0] === 'noodle') return '煮好的麵';
    return '切好的' + NAMES[a[0]];
  }
  function describe(s, pid) {
    var p = s.players[pid];
    var fc = facingCell(p), fk = key(fc[0], fc[1]), ch = cellAt(s, fc[0], fc[1]), t = s.tiles[fk];
    var held = p.held ? s.items[p.held] : null;
    var out = { holding: itemLabel(held), target: '', grab: '', use: '', canThrow: isIng(held) };
    var tn = Level.TILES[ch] ? Level.TILES[ch].name : '';
    out.target = tn;
    if (ch === 'I' && t) out.target = NAMES[t.item] + '箱';
    if (t && t.holds) out.target = tn + '上的' + itemLabel(s.items[t.holds]);
    if (ch === 'S') {
      var pot = t.pot;
      out.target = pot.burnt ? '燒焦的鍋子' : !pot.contents.length ? '空鍋' :
        potReady(pot) ? '煮好的' + contentLabel(potOutput(pot)) :
        '鍋子（' + pot.contents.map(function (n) { return NAMES[n]; }).join('、') + (potComplete(pot) ? '，煮' + Math.floor(pot.cook / CFG.cookSec * 100) + '%' : '，還差 ' + (CFG.soupSize - pot.contents.length) + ' 份') + '）';
      if (pot.burnt) out.use = '清掉';
    }
    if (ch === 'P' && t) out.target = '盤架（' + t.clean + ' 個）';
    if (ch === 'R' && t) out.target = '回收口（' + t.dirty + ' 個髒盤）';
    if (ch === 'K' && t) out.target = '水槽（' + t.dirty + ' 個待洗）';
    if (ch === '.') out.target = '';

    // 試算按「拿」會發生什麼，但不真的改狀態
    var test = clone(s), r = grab(test, test.players[pid]);
    var GRAB = { pick: '拿起', crate: '拿' + (t && t.item ? NAMES[t.item] : ''), plate: '拿盤子', dirty: '拿髒盤', pickFloor: '撿起來',
      place: '放下', toPlate: '裝盤', toPot: '放進鍋', fromPot: '盛到盤子', serve: '出餐', trash: '丟掉', trashPlate: '倒掉盤裡的菜',
      toSink: '放進水槽', toRack: '放回盤架', drop: '放在地上' };
    out.grab = r ? GRAB[r] : '';
    if (ch === 'O' && isPlate(held) && held.contents.length && !r) out.grab = '沒有這道菜的訂單';
    if (ch === 'B' && !held && t.holds) {
      var it = s.items[t.holds];
      if (isIng(it) && it.state === 'raw' && CHOPPABLE[it.name]) out.use = '按住切（' + Math.round(it.chop * 100) + '%）';
    }
    if (ch === 'K' && !held && t.dirty > 0) out.use = '按住洗';
    return out;
  }

  return {
    CFG: CFG, SIGNATURE: SIGNATURE, NAMES: NAMES,
    createGame: createGame, step: step, describe: describe, facingCell: facingCell,
    checkInvariants: checkInvariants, plateCount: plateCount, itemLabel: itemLabel, contentLabel: contentLabel,
    potReady: potReady, potComplete: potComplete
  };
});
