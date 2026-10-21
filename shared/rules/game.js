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
    speed: 3.8,            // 格/秒（搖桿推到底）
    slowSpeed: 0.5,        // 搖桿推一點點時的速度倍率
    deadzone: 0.25,        // 搖桿中心不反應的範圍
    fullAt: 0.6,           // 推超過這個比例就是全速
    radius: 0.3,           // 角色碰撞半徑（格）
    reach: 1.5,            // 能互動的最遠距離（格中心到角色中心）
    assist: 0.6,           // 對準容錯：比最佳那格差多少分以內也算
    chopSec: 1.2,          // 切好要幾秒（按一下就自動切，走開才中斷）
    washSec: 1.5,          // 洗一個盤子
    cookSec: 8,            // 煮熟
    burnSec: 14,           // 煮熟後再過幾秒燒焦
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
  // 盤子能不能再放 add：
  // (1) 湊得成本關某道菜的一部分（沙拉、湯、麵）；或
  // (2) 當托盤：裝同一種切好的湯料，最多 soupSize 份，之後整盤倒進鍋。
  function plateCanTake(s, plate, add) {
    if (plate.dirty) return false;
    if (trayOk(plate, add)) return true;
    if (plate.contents.indexOf(add) >= 0) return false;
    var next = plate.contents.concat([add]);
    return s.dishes.some(function (d) {
      var sig = SIGNATURE[d];
      return sig && next.every(function (c) { return sig.indexOf(c) >= 0; });
    });
  }
  function ingTag(it) { return it.name + ':' + it.state; }
  function trayOk(plate, add) {
    var a = add.split(':');
    if (a[1] !== 'cut' || !SOUP_OK[a[0]]) return false;
    if (plate.contents.length >= CFG.soupSize) return false;
    return plate.contents.every(function (c) { return c === add; });
  }
  function isTray(plate) {
    return plate.contents.length > 0 && plate.contents.every(function (c) {
      var a = c.split(':'); return a[1] === 'cut' && SOUP_OK[a[0]] && c === plate.contents[0];
    });
  }

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

  // ── 對準：在身邊（含斜角）找最可能要互動的格子 ──
  // 分數＝距離 − 面向加權；只看前方與側邊，正後方不算。
  function candidates(s, p) {
    var cx = Math.floor(p.x), cy = Math.floor(p.y), fl = Math.hypot(p.fx, p.fy) || 1, out = [];
    var fc = facingCell(p);
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var x = cx + dx, y = cy + dy, ch = cellAt(s, x, y);
      if (ch === '.' || ch === '#' || ch === ' ') continue;
      var vx = x + 0.5 - p.x, vy = y + 0.5 - p.y, d = Math.hypot(vx, vy);
      if (d > CFG.reach) continue;
      var dot = (vx * p.fx + vy * p.fy) / (d * fl);
      if (dot < -0.3) continue;
      var score = d * 0.8 - dot * 1.2 - (x === fc[0] && y === fc[1] ? 0.4 : 0);
      out.push({ x: x, y: y, score: score });
    }
    out.sort(function (a, b) { return a.score - b.score; });
    // 只保留跟最佳那格差不多的（容錯），避免「對著爐子卻放到旁邊檯面」
    return out.filter(function (c) { return c.score <= out[0].score + CFG.assist; });
  }
  function faceTo(p, x, y) {
    var vx = x + 0.5 - p.x, vy = y + 0.5 - p.y, l = Math.hypot(vx, vy) || 1;
    p.fx = vx / l; p.fy = vy / l;
  }
  // 找第一個「按拿會有反應」的格子；用複本試算，不改真正的狀態
  function grabTarget(s, p) {
    var list = candidates(s, p);
    for (var i = 0; i < list.length; i++) {
      var dry = clone(s), dp = dry.players[p.id];
      if (grabAt(dry, dp, [list[i].x, list[i].y])) return [list[i].x, list[i].y];
    }
    return null;
  }
  function useOk(s, p, c) {
    var ch = cellAt(s, c[0], c[1]), t = s.tiles[key(c[0], c[1])];
    if (ch === 'B' && !p.held && t.holds) { var it = s.items[t.holds]; return isIng(it) && it.state === 'raw' && !!CHOPPABLE[it.name]; }
    if (ch === 'K' && !p.held && t.dirty > 0 && !!s.rack) return true;
    if (ch === 'S' && t.pot.burnt) return true;
    return false;
  }
  function useTarget(s, p) {
    var list = candidates(s, p);
    for (var i = 0; i < list.length; i++) if (useOk(s, p, [list[i].x, list[i].y])) return [list[i].x, list[i].y];
    return null;
  }

  // ── 一顆鍵：在最可能的那一格上，能切／洗／清鍋就做，不然就拿或放 ──
  // 例：砧板上有生番茄 → 切；切好了 → 拿起來；空手對水槽 → 洗；拿髒盤對水槽 → 放進去。
  function actTarget(s, p) {
    var list = candidates(s, p);
    for (var i = 0; i < list.length; i++) {
      var c = [list[i].x, list[i].y];
      if (useOk(s, p, c)) return { c: c, use: true };
      var dry = clone(s);
      if (grabAt(dry, dry.players[p.id], c)) return { c: c, use: false };
    }
    return null;
  }
  function act(s, p) {
    var t = actTarget(s, p);
    if (t) {
      faceTo(p, t.c[0], t.c[1]);
      if (t.use) return startUseAt(s, p, t.c);
      p.busy = null;
      return grabAt(s, p, t.c);
    }
    p.busy = null;
    if (p.held && candidates(s, p).length) return null;
    return grabFloor(s, p);
  }

  // ── 拿 / 放 ──
  function grab(s, p) {
    var c = grabTarget(s, p);
    if (c) { faceTo(p, c[0], c[1]); return grabAt(s, p, c); }
    // 手上有東西、身邊又有工作台但都放不了：保留在手上（不要不小心掉在地上）
    if (p.held && candidates(s, p).length) return null;
    return grabFloor(s, p);
  }
  // 身邊沒有可互動的格子：撿地上的東西，或把手上的東西放在面前的地上
  function grabFloor(s, p) {
    var held = p.held ? s.items[p.held] : null;
    if (!held) {
      var fl = floorItemNear(s, p);
      if (fl) { fl.at = { hand: p.id }; p.held = fl.id; return 'pickFloor'; }
      return null;
    }
    var fc = facingCell(p);
    if (walkable(s, fc[0], fc[1])) { held.at = { floor: [fc[0] + 0.5, fc[1] + 0.5] }; p.held = null; return 'drop'; }
    if (walkable(s, Math.floor(p.x), Math.floor(p.y))) { held.at = { floor: [p.x, p.y] }; p.held = null; return 'drop'; }
    return null;
  }
  function grabAt(s, p, fc) {
    var fk = key(fc[0], fc[1]), ch = cellAt(s, fc[0], fc[1]), t = s.tiles[fk];
    var held = p.held ? s.items[p.held] : null;

    if (!held) {
      if (t && t.holds) { var it = s.items[t.holds]; t.holds = null; it.at = { hand: p.id }; p.held = it.id; return 'pick'; }
      if (ch === 'I' && t.item) {
        var ni = newItem(s, { kind: 'ing', name: t.item, state: 'raw', chop: 0, at: { hand: p.id } });
        p.held = ni.id; s.stats.spawned++; return 'crate';
      }
      if (ch === 'P' && t.clean > 0) { t.clean--; p.held = newItem(s, { kind: 'plate', dirty: false, contents: [], at: { hand: p.id } }).id; return 'plate'; }
      if (ch === 'R' && t.dirty > 0) { t.dirty--; p.held = newItem(s, { kind: 'plate', dirty: true, contents: [], at: { hand: p.id } }).id; return 'dirty'; }
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
      if (isPlate(held) && isTray(held)) {                // 托盤上的湯料倒進鍋
        var name = held.contents[0].split(':')[0], poured = 0;
        while (held.contents.length && potAccepts(pot, { kind: 'ing', name: name, state: 'cut' })) {
          held.contents.pop(); pot.contents.push(name); poured++;
        }
        if (poured) return 'pour';
      }
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
    return null;
  }

  function floorItemNear(s, p) {
    var px = p.x + p.fx * 0.4, py = p.y + p.fy * 0.4, best = null, bd = 1.2;
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
          if (q.id === a.by || Math.hypot(q.x - a.x, q.y - a.y) >= 0.6) return false;
          if (!q.held) return true;
          var qh = s.items[q.held];
          return isPlate(qh) && plateCanTake(s, qh, ingTag(it));   // 拿著盤子也能接
        });
        if (catcher) {
          if (catcher.held) { s.items[catcher.held].contents.push(ingTag(it)); removeItem(s, it.id); s.stats.merged++; }
          else { it.at = { hand: catcher.id }; catcher.held = it.id; }
          s.events.push({ t: 'catch', pid: catcher.id }); break;
        }
        if (ch === '.' || ch === ' ') {
          if (a.dist >= CFG.throwRange) { land(s, it, a.x, a.y, px, py); break; }
          continue;
        }
        // 撞到格子
        var t = s.tiles[ck];
        if (ch === 'S' && potAccepts(t.pot, it)) { putInPot(s, t.pot, it); s.events.push({ t: 'potIn' }); break; }
        if (ch === 'T') { removeItem(s, it.id); s.stats.trashed++; break; }
        if (t && 'holds' in t && !t.holds) { t.holds = it.id; it.at = { tile: ck }; break; }
        if (t && t.holds && isPlate(s.items[t.holds]) && plateCanTake(s, s.items[t.holds], ingTag(it))) {   // 落進檯面上的盤子
          s.items[t.holds].contents.push(ingTag(it)); removeItem(s, it.id); s.stats.merged++; break;
        }
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

  // ── 切 / 洗 / 清鍋 ──
  // 按一下就開始，之後自動進行到完成；移動、拿東西或目標不能做了才中斷。
  function startUse(s, p) {
    var c = useTarget(s, p);
    if (!c) return false;
    faceTo(p, c[0], c[1]);
    return startUseAt(s, p, c);
  }
  function startUseAt(s, p, c) {
    var ch = cellAt(s, c[0], c[1]);
    if (ch === 'S') {                                    // 清燒焦的鍋：一下就好
      s.tiles[key(c[0], c[1])].pot = { contents: [], cook: 0, burnt: false };
      s.events.push({ t: 'cleared', pid: p.id }); p.busy = null; return 'clear';
    }
    var kind = ch === 'B' ? 'chop' : 'wash';
    p.busy = { kind: kind, x: c[0], y: c[1] };
    return kind;
  }
  function workBusy(s, p, dt) {
    var b = p.busy, c = [b.x, b.y], t = s.tiles[key(b.x, b.y)];
    if (!useOk(s, p, c)) { p.busy = null; return; }
    if (b.kind === 'chop') {
      var it = s.items[t.holds];
      it.chop = Math.min(1, it.chop + dt / CFG.chopSec);
      if (it.chop >= 1) { it.state = 'cut'; p.busy = null; s.events.push({ t: 'chopped', pid: p.id }); }
    } else {
      t.wash += dt / CFG.washSec;
      if (t.wash >= 1) {
        t.wash = 0; t.dirty--; s.tiles[s.rack].clean++; s.events.push({ t: 'washed', pid: p.id });
        if (t.dirty <= 0) p.busy = null;                  // 有好幾個髒盤就接著洗
      }
    }
  }

  // ── 移動 ──
  // 搖桿：中心一小圈不反應；推一點是慢走、推過 fullAt 就全速。轉向立刻生效。
  function move(s, p, mx, my, dt) {
    var len = Math.hypot(mx, my);
    if (len < CFG.deadzone) return false;
    var ux = mx / len, uy = my / len;
    p.fx = ux; p.fy = uy;
    var sp = CFG.speed * (len >= CFG.fullAt ? 1 : CFG.slowSpeed);
    var nx = p.x + ux * sp * dt, ny = p.y + uy * sp * dt;
    if (!blocked(s, nx, p.y)) p.x = nx;
    if (!blocked(s, p.x, ny)) p.y = ny;
    return true;
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
        var pat = Math.round((CFG.patience[dish] || 60) * (s.difficulty.patienceScale || 1));
        s.orders.push({ id: s.nextOrderId++, dish: dish, timeLeft: pat, total: pat });
        s.events.push({ t: 'order', dish: dish });
      }
      s.nextOrderIn = s.difficulty.orderEverySec;
    }
  }

  // ── 一個 tick ──
  // inputs[pid] = { mx, my, act: bool（主按鍵：拿／放／切／洗，這一刻按下）, throw: bool }
  // 舊的分開按鍵 grab / use 仍支援（測試與日後設定用）
  function step(prev, inputs, dt) {
    var s = clone(prev);
    s.events = [];
    if (s.ended) return s;
    inputs = inputs || {};

    s.players.forEach(function (p) {
      var inp = inputs[p.id] || {};
      var moved = move(s, p, inp.mx || 0, inp.my || 0, dt);
      if (moved) p.busy = null;
      if (inp.grab) { p.busy = null; var r = grab(s, p); s.events.push({ t: r ? 'grab:' + r : 'nothing', pid: p.id }); }
      if (inp['throw']) { var r2 = throwItem(s, p); if (r2) s.events.push({ t: 'throw', pid: p.id }); }
      if (inp.act) { var ra = act(s, p); s.events.push({ t: ra ? 'act:' + ra : 'nothing', pid: p.id }); }
      if (inp.use && !moved && !p.busy) startUse(s, p);
      if (p.busy) workBusy(s, p, dt);
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
      if (isTray(it)) return '盤子（' + contentLabel(it.contents[0]) + ' ×' + it.contents.length + '）';
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
    var at = actTarget(s, p), gc = grabTarget(s, p), uc = useTarget(s, p);
    var fc = (at && at.c) || facingCell(p), fk = key(fc[0], fc[1]), ch = cellAt(s, fc[0], fc[1]), t = s.tiles[fk];
    var held = p.held ? s.items[p.held] : null;
    var out = { holding: itemLabel(held), target: '', grab: '', use: '', act: '', canThrow: isIng(held), cell: at ? at.c : null, busy: !!p.busy };
    if (!at && !held) { var fl = floorItemNear(s, p); if (fl) out.floor = fl.at.floor; }
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
      toSink: '放進水槽', toRack: '放回盤架', drop: '放在地上', pour: '倒進鍋' };
    out.grab = r ? GRAB[r] : '';
    if (ch === 'O' && isPlate(held) && held.contents.length && !r) out.grab = '沒有這道菜的訂單';
    out.use = '';
    if (uc) {
      var uch = cellAt(s, uc[0], uc[1]), ut = s.tiles[key(uc[0], uc[1])];
      if (uch === 'B') out.use = p.busy ? '切菜中 ' + Math.round(s.items[ut.holds].chop * 100) + '%' : '切';
      if (uch === 'K') out.use = p.busy ? '洗碗中' : '洗盤子';
      if (uch === 'S') out.use = '清掉焦鍋';
    }
    // 主按鍵
    var test2 = clone(s), ra = act(test2, test2.players[pid]);
    var ACT = { chop: '切', wash: '洗盤子', clear: '清掉焦鍋' };
    out.act = ra ? (ACT[ra] || GRAB[ra] || '') : '';
    if (p.busy && at && at.use) {
      var bt = s.tiles[key(p.busy.x, p.busy.y)];
      out.act = p.busy.kind === 'chop' && bt.holds ? '切菜中 ' + Math.round(s.items[bt.holds].chop * 100) + '%' : '洗碗中';
    }
    if (ch === 'O' && isPlate(held) && held.contents.length && !ra) out.act = '沒有這道菜的訂單';
    return out;
  }

  return {
    CFG: CFG, SIGNATURE: SIGNATURE, NAMES: NAMES,
    createGame: createGame, step: step, describe: describe, facingCell: facingCell,
    checkInvariants: checkInvariants, plateCount: plateCount, itemLabel: itemLabel, contentLabel: contentLabel,
    potReady: potReady, potComplete: potComplete
  };
});
