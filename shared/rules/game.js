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
    throwSpeed: 5.5,       // 丟出的水平速度（格/秒）
    throwUp: 3.2,          // 往上拋的初速
    gravity: 14,           // 重力（約 4 格遠落地）
    launchH: 0.75,         // 出手高度
    bounce: 0.25,          // 落地反彈係數
    slideFriction: 9,      // 落地後滑行減速（格/秒²）
    aimCone: 40,           // 丟出自動瞄準：面向左右各幾度內找目標
    aimRange: 5,           // 自動瞄準最遠幾格
    dashSpeed: 11,         // 衝刺速度（格/秒）
    dashSec: 0.2,          // 衝刺持續秒數（約 2 格）
    dashCooldown: 0.6,     // 衝刺冷卻
    counterH: 0.6,         // 檯面、工作台高度：後面不是牆時，飛得比這高就越過去
    wallH: 0.45,           // 牆高度：中間的隔牆飛得比這高、後面落得到地板就越過去（外牆一定擋）
    tipMax: 20,            // 小費上限
    expirePenalty: 20,     // 訂單逾時扣分
    wrongPenalty: 20,      // 送錯餐扣分（照樣收走，盤子會回來）
    patience: { salad: 50, tomato_soup: 70, onion_soup: 70, mushroom_soup: 70, tomato_noodle: 80 },
    firstOrderSec: 2,
    refillSec: 2           // 訂單全清空後，最多等幾秒補下一張
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
    var tiles = {}, firstRack = null, returns = [], stoves = [];
    cells.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        var ch = row[x], k = key(x, y);
        if (HOLD_TILES[ch]) tiles[k] = { holds: null };
        if (ch === 'B') tiles[k] = { holds: null };
        if (ch === 'S') { tiles[k] = { holds: null }; stoves.push(k); }   // 爐子＝平台，什麼都能放；只有鍋子放上去才會煮
        if (ch === 'P') { tiles[k] = { clean: 0 }; if (!firstRack) firstRack = k; }
        if (ch === 'R') { tiles[k] = { dirty: 0 }; returns.push(k); }
        if (ch === 'K') tiles[k] = { dirty: 0, wash: 0, clean: 0 };   // clean：洗好、放在水槽旁的盤子
        if (ch === 'I') tiles[k] = { item: (props[k] || {}).item, holds: null };   // 箱子上可以暫放東西；放了就打不開
      }
    });
    if (firstRack) tiles[firstRack].clean = level.plates || CFG.plates;
    // 每個水槽找一格相鄰的檯面當「晾盤位」：洗好的盤子直接疊在那裡
    cells.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] !== 'K') continue;
        var order = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var i = 0; i < order.length; i++) {
          var nx = x + order[i][0], ny = y + order[i][1];
          if (ny >= 0 && ny < cells.length && nx >= 0 && nx < row.length && cells[ny][nx] === 'C') { tiles[key(x, y)].dry = key(nx, ny); break; }
        }
      }
    });
    var items = {}, nextId = 1;
    stoves.forEach(function (k) {
      var id = 'i' + nextId++;
      items[id] = { id: id, kind: 'pot', contents: [], cook: 0, burnt: false, at: { tile: k } };
      tiles[k].holds = id;
    });
    var players = r.spawns.map(function (s, i) {
      return { id: i, x: s[0] + 0.5, y: s[1] + 0.5, fx: 0, fy: -1, held: null, busy: null, dashT: 0, dashCd: 0 };
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
      items: items, nextId: nextId,
      tiles: tiles, rack: firstRack, returns: returns,
      pendingReturn: [],          // 出餐後等著回來的盤子：[秒數]
      orders: [], nextOrderIn: CFG.firstOrderSec, nextOrderId: 1,
      score: 0,
      stats: { served: 0, failed: 0, base: 0, tips: 0, penalty: 0, spawned: 0, trashed: 0, merged: 0, totalPlates: firstRack ? (level.plates || CFG.plates) : 0, totalPots: stoves.length },
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
  function isPot(it) { return it && it.kind === 'pot'; }
  function pn(it) { return it.n || 1; }                      // 一疊盤子有幾個
  // 空盤可以疊：都沒裝東西、乾淨／髒一致
  function stackable(a, b) {
    return isPlate(a) && isPlate(b) && !a.contents.length && !b.contents.length && !!a.dirty === !!b.dirty;
  }

  // 這個盤子加上 add 之後，還有沒有可能湊成本關的某道菜
  // 盤子能不能再放 add：
  // (1) 湊得成本關某道菜的一部分（沙拉、湯、麵）；或
  // (2) 當托盤：裝同一種切好的湯料，最多 soupSize 份，之後整盤倒進鍋。
  // 一疊乾淨盤也可以放：東西放在最上面那一個盤子上。
  // 只有處理好的東西能上盤：切好的食材、煮好的湯／麵（生的不行）。
  function plateCanTake(s, plate, add) {
    if (plate.dirty) return false;
    var st = add.split(':')[1];
    if (add.split(':')[0] !== 'soup' && st !== 'cut' && st !== 'cooked') return false;
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
  function emptyPot(pot) { pot.contents = []; pot.cook = 0; pot.burnt = false; }
  function emptySingle(plate) { return !plate.dirty && !plate.contents.length && pn(plate) === 1; }
  // 托盤（盤子上同一種切好的湯料）倒進鍋；回傳倒了幾份
  function pourTray(plate, pot) {
    if (!isTray(plate)) return 0;
    var name = plate.contents[0].split(':')[0], poured = 0;
    while (plate.contents.length && potAccepts(pot, { kind: 'ing', name: name, state: 'cut' })) { plate.contents.pop(); pot.contents.push(name); poured++; }
    return poured;
  }
  // 兩個東西碰在一起（手上的 held 對著檯面上的 on）會發生什麼；成功就改狀態並回傳代碼
  function combine(s, p, held, on, t) {
    if (stackable(on, held)) { on.n = pn(on) + pn(held); removeItem(s, held.id); p.held = null; return 'stack'; }
    if (isPlate(on) && isIng(held) && plateCanTake(s, on, ingTag(held))) { on.contents.push(ingTag(held)); removeItem(s, held.id); p.held = null; s.stats.merged++; return 'toPlate'; }
    if (isPlate(held) && isIng(on) && plateCanTake(s, held, ingTag(on))) { held.contents.push(ingTag(on)); removeItem(s, on.id); t.holds = null; s.stats.merged++; return 'toPlate'; }
    // 鍋子：跟盤子一樣可以裝、可以倒
    if (isPot(on) && isIng(held) && potAccepts(on, held)) { putInPot(s, on, held); p.held = null; return 'toPot'; }
    if (isPot(held) && isIng(on) && potAccepts(held, on)) { putInPot(s, held, on); t.holds = null; return 'toPot'; }
    if (isPot(on) && isPlate(held) && pourTray(held, on)) return 'pour';
    if (isPot(held) && isPlate(on) && pourTray(on, held)) return 'pour';
    // 燒焦的：空盤可以把焦掉的接出來（之後倒進垃圾桶）；拿著焦鍋對空盤也可以倒進去
    if (isPot(on) && isPlate(held) && on.burnt && emptySingle(held)) { held.contents.push('burnt'); emptyPot(on); return 'scrapeBurnt'; }
    if (isPot(held) && isPlate(on) && held.burnt && emptySingle(on)) { on.contents.push('burnt'); emptyPot(held); return 'scrapeBurnt'; }
    if (isPot(on) && isPlate(held) && potReady(on) && plateCanTake(s, held, potOutput(on))) { held.contents.push(potOutput(on)); emptyPot(on); return 'fromPot'; }
    if (isPot(held) && isPlate(on) && potReady(held) && plateCanTake(s, on, potOutput(held))) { on.contents.push(potOutput(held)); emptyPot(held); return 'potToPlate'; }
    return null;
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
    if (ch === 'K' && !p.held && t.dirty > 0) return true;
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
    return floorOrKeep(s, p);
  }

  // ── 拿 / 放 ──
  function grab(s, p) {
    var c = grabTarget(s, p);
    if (c) { faceTo(p, c[0], c[1]); return grabAt(s, p, c); }
    return floorOrKeep(s, p);
  }
  // 身邊的工作台都沒反應時：先試地上的東西（裝盤、疊盤、倒鍋…），
  // 不行的話，面對地板就放在地上；面對工作台（只是放不下）就留在手上，免得不小心掉地上
  function floorOrKeep(s, p) {
    var held = p.held ? s.items[p.held] : null;
    if (held) {
      var fl = floorItemNear(s, p);
      if (fl) { var r = combine(s, p, held, fl, {}); if (r) return r; }
      var fc = facingCell(p);
      if (candidates(s, p).length && !walkable(s, fc[0], fc[1])) return null;
    }
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
      if (t && t.holds) {
        var it = s.items[t.holds];
        if (isPlate(it) && !it.dirty && pn(it) > 1) {            // 乾淨的一疊：拿最上面一個（連同上面的菜）
          it.n = pn(it) - 1;
          var top = it.contents; it.contents = [];
          p.held = newItem(s, { kind: 'plate', dirty: false, contents: top, n: 1, at: { hand: p.id } }).id;
          return top.length ? 'pick' : 'plate';
        }
        t.holds = null; it.at = { hand: p.id }; p.held = it.id;   // 其他（含髒盤整疊）：整個拿起
        return isPlate(it) && it.dirty && pn(it) > 1 ? 'dirtyStack' : 'pick';
      }
      if (ch === 'I' && t.item) {
        var ni = newItem(s, { kind: 'ing', name: t.item, state: 'raw', chop: 0, at: { hand: p.id } });
        p.held = ni.id; s.stats.spawned++; return 'crate';
      }
      if (ch === 'P' && t.clean > 0) { t.clean--; p.held = newItem(s, { kind: 'plate', dirty: false, contents: [], at: { hand: p.id } }).id; return 'plate'; }
      if (ch === 'K' && t.clean > 0 && t.dirty === 0) { t.clean--; p.held = newItem(s, { kind: 'plate', dirty: false, contents: [], at: { hand: p.id } }).id; return 'plate'; }
      if (ch === 'R' && t.dirty > 0) {                          // 髒盤整疊拿走
        var cnt = t.dirty; t.dirty = 0;
        p.held = newItem(s, { kind: 'plate', dirty: true, contents: [], n: cnt, at: { hand: p.id } }).id;
        return cnt > 1 ? 'dirtyStack' : 'dirty';
      }
      return null;
    }

    // 手上有東西
    if (t && 'holds' in t) {
      var on = t.holds ? s.items[t.holds] : null;
      if (!on) {
        if (ch === 'B' && !isIng(held)) return null;           // 砧板只放食材
        t.holds = held.id; held.at = { tile: fk }; p.held = null; return 'place';
      }
      return combine(s, p, held, on, t);
    }
    if (ch === 'O') return serve(s, p, held);
    if (ch === 'T') {
      if (isIng(held)) { removeItem(s, held.id); p.held = null; s.stats.trashed++; return 'trash'; }
      if (isPlate(held) && held.contents.length) { held.contents = []; return 'trashPlate'; }
      if (isPot(held) && held.contents.length) { emptyPot(held); return 'trashPot'; }   // 焦掉的要整鍋搬來倒
      return null;
    }
    if (ch === 'K' && isPlate(held) && held.dirty) { t.dirty += pn(held); removeItem(s, held.id); p.held = null; return 'toSink'; }
    if (ch === 'P' && isPlate(held) && !held.dirty && !held.contents.length) { t.clean += pn(held); removeItem(s, held.id); p.held = null; return 'toRack'; }
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
    if (idx < 0) {                                        // 送錯：照樣送出、扣分，訂單保留，盤子之後回來
      s.score -= CFG.wrongPenalty; s.stats.wrong = (s.stats.wrong || 0) + 1; s.stats.penalty += CFG.wrongPenalty;
      removeItem(s, held.id); p.held = null;
      s.pendingReturn.push(CFG.returnSec);
      s.events.push({ t: 'wrong', pid: p.id, points: -CFG.wrongPenalty });
      return 'serveWrong';
    }
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
    var aim = aimThrow(s, p, held);                     // 自動瞄準：面向附近有能接的目標就對準它
    var ux = aim[0], uy = aim[1];
    if (aim[2]) { p.fx = ux; p.fy = uy; }
    held.at = { air: { x: p.x + ux * 0.3, y: p.y + uy * 0.3, h: CFG.launchH,
      vx: ux * CFG.throwSpeed, vy: uy * CFG.throwSpeed, vh: CFG.throwUp, by: p.id } };
    p.held = null; return 'throw';
  }

  // ── 丟出的自動瞄準 ──
  // 照面向丟會先撞到普通牆時才修正：在面向 ±aimCone 內、距離 0.6–aimRange 格，找丟過去會被好好接住或越過的目標：
  // 隊友（空手或拿著收得下的盤子）、收得下的鍋子／盤子、垃圾桶、越過後落得到地板的檯面類。
  // 回傳 [ux, uy, 有沒有修正]
  function aimThrow(s, p, it) {
    var fl = Math.hypot(p.fx, p.fy) || 1, fx = p.fx / fl, fy = p.fy / fl;
    if (!rayHitsWall(s, p.x, p.y, fx, fy, it)) return [fx, fy, false];
    var best = null, cosLim = Math.cos(CFG.aimCone * Math.PI / 180);
    function consider(tx, ty, weight) {
      var dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d < 0.6 || d > CFG.aimRange) return;
      var c = (dx * fx + dy * fy) / d;
      if (c < cosLim) return;
      if (!clearPath(s, p.x, p.y, tx, ty)) return;
      var score = (1 - c) * 4 + d * 0.08 - weight;
      if (!best || score < best.score) best = { ux: dx / d, uy: dy / d, score: score };
    }
    s.players.forEach(function (q) {
      if (q.id === p.id) return;
      var qh = q.held ? s.items[q.held] : null;
      if (!qh || (isPlate(qh) && plateCanTake(s, qh, ingTag(it)))) consider(q.x, q.y, 0.6);
    });
    for (var k in s.tiles) {
      var xy = k.split(','), x = +xy[0], y = +xy[1], ch = cellAt(s, x, y), on = s.tiles[k].holds ? s.items[s.tiles[k].holds] : null;
      if ((isPot(on) && potAccepts(on, it)) || (isPlate(on) && plateCanTake(s, on, ingTag(it)))) { consider(x + 0.5, y + 0.5, 0.5); continue; }
      if (!('holds' in s.tiles[k])) continue;
      var dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, d = Math.hypot(dx, dy) || 1;
      if (landsBeyond(s, x + 0.5, y + 0.5, dx / d, dy / d)) consider(x + 0.5, y + 0.5, 0.2);
    }
    return best ? [best.ux, best.uy, true] : [fx, fy, false];
  }
  // 照這個方向丟，在落地範圍內會不會先撞到普通牆（收得下的鍋、盤、垃圾桶、越得過的檯面都不算撞）
  function rayHitsWall(s, x0, y0, ux, uy, it) {
    var lastK = key(Math.floor(x0), Math.floor(y0));
    for (var d = 0.3; d <= 4.6; d += 0.05) {
      var x = x0 + ux * d, y = y0 + uy * d, cx = Math.floor(x), cy = Math.floor(y), k = key(cx, cy);
      if (k === lastK) continue;
      lastK = k;
      var ch = cellAt(s, cx, cy), t = s.tiles[k], on = t && t.holds ? s.items[t.holds] : null;
      if (ch === '.' || ch === ' ') continue;
      if (ch === '#') { if (landsBeyond(s, cx + 0.5, cy + 0.5, ux, uy)) continue; return true; }
      if (ch === 'T' || (isPot(on) && potAccepts(on, it)) || (isPlate(on) && plateCanTake(s, on, ingTag(it)))) return false;
      if (landsBeyond(s, cx + 0.5, cy + 0.5, ux, uy)) continue;
      return false;                                       // 後面是牆：會落在這個檯面上，也算可以
    }
    return false;
  }
  // 從這格往 (ux,uy) 越過去，2.5 格內落得到地板（中間隔牆、檯面都可以越過；外牆後面是地圖外就不行）
  function landsBeyond(s, x0, y0, ux, uy) {
    var sx = Math.floor(x0), sy = Math.floor(y0);
    for (var d = 0.05; d <= 2.5; d += 0.05) {
      var cx = Math.floor(x0 + ux * d), cy = Math.floor(y0 + uy * d);
      if (cx === sx && cy === sy) continue;
      if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) return false;   // 出了地圖（外牆後面）
      if (cellAt(s, cx, cy) === '.') return true;
    }
    return false;
  }
  // 從 (x0,y0) 到 (x1,y1) 的直線上沒有普通牆（不檢查終點那一格）
  function clearPath(s, x0, y0, x1, y1) {
    var d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.1);
    var ex = Math.floor(x1), ey = Math.floor(y1);
    for (var i = 1; i < n; i++) {
      var x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n, cx = Math.floor(x), cy = Math.floor(y);
      if (cx === ex && cy === ey) break;
      if (cellAt(s, cx, cy) === '#' && !landsBeyond(s, x, y, (x1 - x0) / d, (y1 - y0) / d)) return false;
    }
    return true;
  }

  // ── 丟出的物理：拋物線、撞牆反彈、落地彈一下再滑行停住（全部由規則算，伺服器與畫面一致）──
  function flyItems(s, dt) {
    for (var id in s.items) {
      var it = s.items[id], a = it.at.air;
      if (it.at.slide) { slideItem(s, it, dt); continue; }
      if (!a) continue;
      var steps = 4, sdt = dt / steps;
      for (var k = 0; k < steps && it.at.air; k++) {
        var px = a.x, py = a.y;
        a.vh -= CFG.gravity * sdt; a.h += a.vh * sdt;
        a.x += a.vx * sdt; a.y += a.vy * sdt;
        var cx = Math.floor(a.x), cy = Math.floor(a.y), ch = cellAt(s, cx, cy), ck = key(cx, cy);
        // 隊友接住（高度在手的範圍）
        var catcher = s.players.find(function (q) {
          if (q.id === a.by || Math.hypot(q.x - a.x, q.y - a.y) >= 0.6 || a.h < 0.15 || a.h > 1.7) return false;
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
          if (a.h > 0) continue;
          if (ch === ' ') { land(s, it, a.x, a.y, px, py); break; }      // 掉進空地：放回最近的地板
          a.h = 0;
          if (-a.vh > 1.6) {                                               // 落地彈一下
            a.vh = -a.vh * CFG.bounce; a.vx *= 0.55; a.vy *= 0.55;
            s.events.push({ t: 'bounce' });
            continue;
          }
          it.at = { floor: [a.x, a.y], slide: { vx: a.vx * 0.5, vy: a.vy * 0.5 } };   // 開始滑
          break;
        }
        // 碰到工作台或檯面
        var t = s.tiles[ck], on = t && t.holds ? s.items[t.holds] : null;
        // 1) 會「收」東西的一定收：垃圾桶、鍋子、盤子
        if (ch === 'T') { removeItem(s, it.id); s.stats.trashed++; break; }
        if (isPot(on) && potAccepts(on, it)) { putInPot(s, on, it); s.events.push({ t: 'potIn' }); break; }
        if (isPlate(on) && plateCanTake(s, on, ingTag(it))) { on.contents.push(ingTag(it)); removeItem(s, it.id); s.stats.merged++; break; }
        // 2) 牆擋不住的檯面類都可以越過：後面不是牆、而且飛得比它高 → 繼續飛
        if (a.h > (ch === '#' ? CFG.wallH : tileTop(ch)) && landsBeyond(s, a.x, a.y, a.vx / Math.hypot(a.vx, a.vy), a.vy / Math.hypot(a.vx, a.vy))) continue;
        // 3) 後面是牆（或飛太低）：空的就落在上面，不然彈回來
        if (t && 'holds' in t && !t.holds) { t.holds = it.id; it.at = { tile: ck }; break; }
        // 牆或放不下：彈回來、繼續往下掉
        a.x = px; a.y = py; a.vx *= -0.3; a.vy *= -0.3;
        if (a.vh > 0) a.vh = 0;
        s.events.push({ t: 'bonk' });
      }
    }
  }
  // 各種格子的高度（丟出的東西比這高才能越過）
  function tileTop(ch) { return CFG.counterH; }
  // 沿著飛行方向，這一格後面那一格是不是牆（或地圖外）
  function wallBehind(s, cx, cy, a) {
    var l = Math.hypot(a.vx, a.vy) || 1, ux = a.vx / l, uy = a.vy / l, x = a.x, y = a.y;
    for (var i = 0; i < 40; i++) {                     // 沿飛行方向走到離開這一格，看下一格
      x += ux * 0.05; y += uy * 0.05;
      var bx = Math.floor(x), by = Math.floor(y);
      if (bx !== cx || by !== cy) return cellAt(s, bx, by) === '#';
    }
    return false;
  }
  function slideItem(s, it, dt) {
    var f = it.at.floor, v = it.at.slide, sp = Math.hypot(v.vx, v.vy);
    if (sp < 0.05) { delete it.at.slide; return; }
    var nx = f[0] + v.vx * dt, ny = f[1] + v.vy * dt;
    if (walkable(s, Math.floor(nx), Math.floor(ny))) { f[0] = nx; f[1] = ny; }
    else { delete it.at.slide; return; }                       // 碰到檯面或牆就停
    var dec = Math.max(0, sp - CFG.slideFriction * dt) / sp;
    v.vx *= dec; v.vy *= dec;
    if (dec === 0) delete it.at.slide;
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
    var kind = ch === 'B' ? 'chop' : 'wash';
    p.busy = { kind: kind, x: c[0], y: c[1] };
    return kind;
  }
  // 洗好的盤子：疊到水槽旁的晾盤位；那格被別的東西佔住才留在水槽邊
  function putWashed(s, sink) {
    var d = sink.dry ? s.tiles[sink.dry] : null;
    if (d && !d.holds) { d.holds = newItem(s, { kind: 'plate', dirty: false, contents: [], n: 1, at: { tile: sink.dry } }).id; return; }
    if (d && d.holds && stackable(s.items[d.holds], { kind: 'plate', dirty: false, contents: [] })) { s.items[d.holds].n = pn(s.items[d.holds]) + 1; return; }
    sink.clean++;
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
        t.wash = 0; t.dirty--; putWashed(s, t); s.events.push({ t: 'washed', pid: p.id });
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
    // 訂單不中斷：清空了 2 秒內補一張；滿了就等有空位馬上補，不重新計時
    if (!s.orders.length) s.nextOrderIn = Math.min(s.nextOrderIn, CFG.refillSec);
    s.nextOrderIn -= dt;
    if (s.nextOrderIn <= 0) {
      if (s.orders.length >= s.difficulty.maxOrders || !s.dishes.length) { s.nextOrderIn = 0; return; }
      var dish = s.dishes[Math.floor(rand(s) * s.dishes.length)];
      var pat = Math.round((CFG.patience[dish] || 60) * (s.difficulty.patienceScale || 1));
      s.orders.push({ id: s.nextOrderId++, dish: dish, timeLeft: pat, total: pat });
      s.events.push({ t: 'order', dish: dish });
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
      p.dashCd = Math.max(0, (p.dashCd || 0) - dt);
      if (inp.dash && !p.dashT && !p.dashCd) { p.dashT = CFG.dashSec; p.dashCd = CFG.dashSec + CFG.dashCooldown; p.busy = null; s.events.push({ t: 'dash', pid: p.id }); }
      var moved;
      if (p.dashT > 0) {                                 // 衝刺中：朝面向衝，不吃搖桿
        var fl2 = Math.hypot(p.fx, p.fy) || 1, step2 = Math.min(dt, p.dashT);
        var nx2 = p.x + p.fx / fl2 * CFG.dashSpeed * step2, ny2 = p.y + p.fy / fl2 * CFG.dashSpeed * step2;
        if (!blocked(s, nx2, p.y)) p.x = nx2;
        if (!blocked(s, p.x, ny2)) p.y = ny2;
        p.dashT = Math.max(0, p.dashT - dt);
        moved = true;
      } else moved = move(s, p, inp.mx || 0, inp.my || 0, dt);
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
      if (cellAt(s, +k.split(',')[0], +k.split(',')[1]) !== 'S' || !s.tiles[k].holds) continue;
      var pot = s.items[s.tiles[k].holds];
      if (!isPot(pot) || !potComplete(pot) || pot.burnt) continue;
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
    for (var id in s.items) if (isPlate(s.items[id])) n += pn(s.items[id]);
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
    var pots = 0; for (var pid in s.items) if (isPot(s.items[pid])) pots++;
    if (pots !== s.stats.totalPots) errs.push('鍋子數不守恆：' + pots + ' ≠ ' + s.stats.totalPots);
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
      if (it.dirty) return pn(it) > 1 ? '髒盤子 ×' + pn(it) : '髒盤子';
      if (!it.contents.length) return pn(it) > 1 ? '一疊盤子 ×' + pn(it) : '空盤子';
      if (isTray(it)) return '盤子（' + contentLabel(it.contents[0]) + ' ×' + it.contents.length + '）';
      return '盤子（' + it.contents.map(contentLabel).join('＋') + '）';
    }
    if (isPot(it)) {
      if (it.burnt) return '燒焦的鍋子';
      if (!it.contents.length) return '空鍋';
      if (potReady(it)) return '煮好的' + contentLabel(potOutput(it)) + '（鍋）';
      return '鍋子（' + it.contents.map(function (n) { return NAMES[n]; }).join('、') + (potComplete(it) ? (it.cook > 0 ? '，煮' + Math.floor(it.cook / CFG.cookSec * 100) + '%' : '') : '，還差 ' + (CFG.soupSize - it.contents.length) + ' 份') + '）';
    }
    return (it.state === 'cut' ? '切好的' : '') + NAMES[it.name];
  }
  function contentLabel(c) {
    if (c === 'burnt') return '燒焦的東西';
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
    if (!at) { var fl = floorItemNear(s, p); if (fl) out.floor = fl.at.floor; }
    var tn = Level.TILES[ch] ? Level.TILES[ch].name : '';
    out.target = tn;
    if (ch === 'I' && t) out.target = NAMES[t.item] + '箱';
    if (t && t.holds) out.target = tn + '上的' + itemLabel(s.items[t.holds]);
    if (ch === 'S' && t && t.holds) out.target = itemLabel(s.items[t.holds]);
    if (ch === 'S' && t && !t.holds) out.target = '爐子（沒有鍋）';
    if (ch === 'P' && t) out.target = '盤架（' + t.clean + ' 個）';
    if (ch === 'R' && t) out.target = '回收口（' + t.dirty + ' 個髒盤）';
    if (ch === 'K' && t) out.target = '水槽（' + (t.dirty ? t.dirty + ' 個待洗' : '') + (t.dirty && t.clean ? '、' : '') + (t.clean ? t.clean + ' 個乾淨' : '') + (!t.dirty && !t.clean ? '空的' : '') + '）';
    if (ch === '.') out.target = '';

    // 試算按「拿」會發生什麼，但不真的改狀態
    var test = clone(s), r = grab(test, test.players[pid]);
    var GRAB = { pick: '拿起', crate: '拿' + (t && t.item ? NAMES[t.item] : ''), plate: '拿盤子', dirty: '拿髒盤', pickFloor: '撿起來',
      place: '放下', toPlate: '裝盤', toPot: '放進鍋', fromPot: '盛到盤子', serve: '出餐', trash: '丟掉', trashPlate: '倒掉盤裡的菜',
      toSink: '放進水槽', toRack: '放回盤架', drop: '放在地上', pour: '倒進鍋', stack: '疊上去', dirtyStack: '整疊拿走', serveWrong: '出餐（不是訂單上的菜，會扣分）', trashPot: '倒掉鍋裡的東西', potToPlate: '倒進盤子', scrapeBurnt: '把焦掉的接出來' };
    out.grab = r ? GRAB[r] : '';
    out.use = '';
    if (uc) {
      var uch = cellAt(s, uc[0], uc[1]), ut = s.tiles[key(uc[0], uc[1])];
      if (uch === 'B') out.use = p.busy ? '切菜中 ' + Math.round(s.items[ut.holds].chop * 100) + '%' : '切';
      if (uch === 'K') out.use = p.busy ? '洗碗中' : '洗盤子';
    }
    // 主按鍵
    var test2 = clone(s), ra = act(test2, test2.players[pid]);
    var ACT = { chop: '切', wash: '洗盤子' };
    out.act = ra ? (ACT[ra] || GRAB[ra] || '') : '';
    if (p.busy && at && at.use) {
      var bt = s.tiles[key(p.busy.x, p.busy.y)];
      out.act = p.busy.kind === 'chop' && bt.holds ? '切菜中 ' + Math.round(s.items[bt.holds].chop * 100) + '%' : '洗碗中';
    }
    return out;
  }

  return {
    CFG: CFG, SIGNATURE: SIGNATURE, NAMES: NAMES,
    createGame: createGame, step: step, describe: describe, facingCell: facingCell,
    checkInvariants: checkInvariants, plateCount: plateCount, itemLabel: itemLabel, contentLabel: contentLabel,
    potReady: potReady, potComplete: potComplete, isPot: isPot
  };
});
