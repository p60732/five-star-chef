// 關卡規則（純函式）：關卡依人數展開、關卡檢查。
// 編輯器與日後的伺服器共用這一份；不碰 DOM、不讀時間、不修改傳入資料。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Level = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TILES = {
    '.': { name: '地板', walk: true },
    '#': { name: '牆' },
    ' ': { name: '空地（不能走，可以丟過去）' },
    'C': { name: '檯面', hold: true },
    'I': { name: '食材箱', station: true },
    'B': { name: '砧板', station: true, hold: true },
    'S': { name: '爐（附鍋）', station: true },
    'K': { name: '水槽', station: true },
    'D': { name: '晾盤架（水槽旁，洗好的盤子放這裡）', station: true, hold: true },
    'P': { name: '盤架', station: true },
    'R': { name: '髒盤回收口', station: true },
    'O': { name: '出餐口', station: true },
    'T': { name: '垃圾桶', station: true },
    'V': { name: '輸送帶', hold: true, mech: true },
    'M': { name: '移動檯面', hold: true, mech: true },
    'W': { name: '定時窗口', hold: true, mech: true }
  };

  var INGREDIENTS = {
    tomato: { name: '番茄' },
    lettuce: { name: '生菜' },
    onion: { name: '洋蔥' },
    mushroom: { name: '蘑菇' },
    noodle: { name: '麵' }
  };

  // need：每種食材要的處理（cut 切、raw 直接用）；pot：是否要下鍋
  var DISHES = {
    salad: { name: '沙拉', score: 40, pot: false, need: { lettuce: 'cut', tomato: 'cut' } },
    tomato_soup: { name: '番茄湯', score: 60, pot: true, need: { tomato: 'cut' } },
    onion_soup: { name: '洋蔥湯', score: 60, pot: true, need: { onion: 'cut' } },
    mushroom_soup: { name: '蘑菇湯', score: 60, pot: true, need: { mushroom: 'cut' } },
    tomato_noodle: { name: '番茄麵', score: 80, pot: true, need: { noodle: 'raw', tomato: 'cut' } }
  };

  // 人數難度（第一版預設值，之後試玩再調）
  var DIFFICULTY = {
    1: { orderEverySec: 34, maxOrders: 2, scoreScale: 0.5, patienceScale: 1.6 },
    2: { orderEverySec: 24, maxOrders: 3, scoreScale: 0.75, patienceScale: 1.3 },
    3: { orderEverySec: 18, maxOrders: 4, scoreScale: 0.9, patienceScale: 1.15 },
    4: { orderEverySec: 15, maxOrders: 4, scoreScale: 1.0, patienceScale: 1 },
    5: { orderEverySec: 13, maxOrders: 5, scoreScale: 1.15, patienceScale: 1 },
    6: { orderEverySec: 12, maxOrders: 5, scoreScale: 1.3, patienceScale: 1 },
    7: { orderEverySec: 11, maxOrders: 6, scoreScale: 1.45, patienceScale: 1 },
    8: { orderEverySec: 10, maxOrders: 6, scoreScale: 1.6, patienceScale: 1 }
  };

  var DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  var MIN_SIZE = 7, MAX_SIZE = 20;

  function key(x, y) { return x + ',' + y; }

  // 依人數展開：min 未達 → 變成檯面；upTo 且人數 ≤ upTo → 變成地板（門）
  function resolve(level, n) {
    var props = level.props || {};
    var cells = level.grid.map(function (row, y) {
      return row.split('').map(function (ch, x) {
        var p = props[key(x, y)] || {};
        if (p.min && n < p.min) return 'C';
        if (p.upTo && n <= p.upTo) return '.';
        return ch;
      });
    });
    return { cells: cells, spawns: (level.spawns || []).slice(0, n) };
  }

  function starsFor(level, n) {
    var s = DIFFICULTY[n].scoreScale;
    return (level.stars || []).map(function (v) { return Math.round(v * s / 10) * 10; });
  }

  // 移動檯面經過的格子（含起點）
  function moverPath(x, y, p) {
    var d = DIRS[p.dir] || [0, 0], out = [];
    for (var i = 0; i <= (p.len || 0); i++) out.push([x + d[0] * i, y + d[1] * i]);
    return out;
  }

  function at(cells, x, y) {
    if (y < 0 || y >= cells.length || x < 0 || x >= cells[0].length) return null;
    return cells[y][x];
  }

  // 從起點走得到的地板
  function flood(cells, sx, sy) {
    var seen = {}, q = [[sx, sy]];
    if (at(cells, sx, sy) !== '.') return seen;
    seen[key(sx, sy)] = true;
    while (q.length) {
      var c = q.shift();
      for (var d in DIRS) {
        var nx = c[0] + DIRS[d][0], ny = c[1] + DIRS[d][1], k = key(nx, ny);
        if (!seen[k] && at(cells, nx, ny) === '.') { seen[k] = true; q.push([nx, ny]); }
      }
    }
    return seen;
  }

  function touches(region, x, y) {
    for (var d in DIRS) if (region[key(x + DIRS[d][0], y + DIRS[d][1])]) return true;
    return false;
  }

  function requirements(level) {
    var need = { I: {}, B: false, S: false, P: true, O: true };
    (level.dishes || []).forEach(function (id) {
      var dish = DISHES[id];
      if (!dish) return;
      if (dish.pot) need.S = true;
      for (var ing in dish.need) {
        need.I[ing] = true;
        if (dish.need[ing] === 'cut') need.B = true;
      }
    });
    return need;
  }

  function validate(level) {
    var errors = [], warnings = [];
    var props = level.props || {};
    var g = level.grid || [];

    // ── 結構 ──
    if (!level.name || !String(level.name).trim()) errors.push('關卡沒有名字');
    if (g.length < MIN_SIZE || g.length > MAX_SIZE) errors.push('高度要在 ' + MIN_SIZE + '–' + MAX_SIZE + ' 格');
    var w = g[0] ? g[0].length : 0;
    if (w < MIN_SIZE || w > MAX_SIZE) errors.push('寬度要在 ' + MIN_SIZE + '–' + MAX_SIZE + ' 格');
    if (g.some(function (r) { return r.length !== w; })) { errors.push('每一列寬度不一樣'); return { errors: errors, warnings: warnings }; }
    g.forEach(function (row, y) {
      row.split('').forEach(function (ch, x) {
        if (!TILES[ch]) errors.push('(' + x + ',' + y + ') 是不認得的格子「' + ch + '」');
        var edge = x === 0 || y === 0 || x === w - 1 || y === g.length - 1;
        if (edge && ch === '.') warnings.push('(' + x + ',' + y + ') 地板在邊緣，角色可能走出地圖');
      });
    });
    if (!(level.timeSec >= 60 && level.timeSec <= 600)) errors.push('關卡時間要在 60–600 秒');
    if (!(level.dishes && level.dishes.length)) errors.push('至少要選一道菜');
    (level.dishes || []).forEach(function (d) { if (!DISHES[d]) errors.push('不認得的菜「' + d + '」'); });
    var st = level.stars || [];
    if (st.length !== 3 || !(st[0] > 0 && st[0] < st[1] && st[1] < st[2])) errors.push('三顆星的分數要由小到大');

    // ── 每格的設定 ──
    var moverCells = {};
    g.forEach(function (row, y) {
      row.split('').forEach(function (ch, x) {
        var p = props[key(x, y)] || {}, at_ = '(' + x + ',' + y + ') ';
        if (ch === 'I' && !INGREDIENTS[p.item]) errors.push(at_ + '食材箱沒有設定食材');
        if (ch === 'V' && !DIRS[p.dir]) errors.push(at_ + '輸送帶沒有方向');
        if (ch === 'W' && !(p.open > 0 && p.closed > 0)) errors.push(at_ + '定時窗口要設定開、關秒數');
        if (ch === 'M') {
          if (!DIRS[p.dir] || !(p.len >= 1)) errors.push(at_ + '移動檯面要設定方向和距離');
          else moverPath(x, y, p).slice(1).forEach(function (c) {
            var t = g[c[1]] && g[c[1]][c[0]];
            if (t !== ' ' && t !== 'M') errors.push(at_ + '移動檯面的路線經過 (' + c[0] + ',' + c[1] + ')，那裡要是空地');
            moverCells[key(c[0], c[1])] = true;
          });
        }
        if (p.min && !TILES[ch].station) warnings.push(at_ + '「多人才出現」只對工作台有意義');
        if (p.upTo && ch !== '#' && ch !== ' ' && ch !== 'V' && ch !== 'C') warnings.push(at_ + '「人少時變地板」通常放在牆、檯面、空地或輸送帶上');
      });
    });

    // ── 出生點 ──
    var sp = level.spawns || [];
    if (sp.length !== 8) errors.push('要剛好 8 個出生點（現在 ' + sp.length + ' 個）');
    var seenSp = {};
    sp.forEach(function (s, i) {
      var k = key(s[0], s[1]);
      if (seenSp[k]) errors.push('出生點 ' + (i + 1) + ' 跟別的出生點重疊');
      seenSp[k] = true;
    });

    // ── 食材箱是否齊全 ──
    var need = requirements(level);
    var crates = {};
    g.forEach(function (row, y) { row.split('').forEach(function (ch, x) {
      if (ch === 'I' && props[key(x, y)]) crates[props[key(x, y)].item] = true;
    }); });
    Object.keys(need.I).forEach(function (ing) {
      if (!crates[ing]) errors.push('菜單要用' + INGREDIENTS[ing].name + '，但沒有' + INGREDIENTS[ing].name + '的食材箱');
    });

    if (errors.length) return { errors: errors, warnings: warnings };

    // ── 1–8 人逐一檢查走不走得到 ──
    for (var n = 1; n <= 8; n++) {
      var r = resolve(level, n), cells = r.cells, tag = n + ' 人：';
      var regions = [], all = {};
      r.spawns.forEach(function (s, i) {
        if (at(cells, s[0], s[1]) !== '.') { errors.push(tag + '出生點 ' + (i + 1) + ' 不在地板上'); return; }
        var reg = flood(cells, s[0], s[1]);
        for (var k in reg) all[k] = true;
        if (!regions.some(function (rg) { return rg[key(s[0], s[1])]; })) regions.push(reg);
      });

      // 必要的工作台：走得到才算
      var have = { B: false, S: false, P: false, O: false, K: false, R: false }, crateOk = {};
      cells.forEach(function (row, y) { row.forEach(function (ch, x) {
        if (!touches(all, x, y)) return;
        if (ch in have) have[ch] = true;
        if (ch === 'I' && props[key(x, y)]) crateOk[props[key(x, y)].item] = true;
      }); });
      if (need.B && !have.B) errors.push(tag + '走不到砧板');
      if (need.S && !have.S) errors.push(tag + '走不到爐子');
      if (!have.P) errors.push(tag + '走不到盤架');
      if (!have.O) errors.push(tag + '走不到出餐口');
      if (have.R && !have.K) errors.push(tag + '有髒盤回收口但走不到水槽');
      if (!have.R) warnings.push(tag + '沒有髒盤回收口，盤子出餐後不會回來');
      Object.keys(need.I).forEach(function (ing) {
        if (!crateOk[ing]) errors.push(tag + '走不到' + INGREDIENTS[ing].name + '的食材箱');
      });

      // 多個區域之間要有傳東西的方法（檯面、窗口、輸送帶、移動檯面相鄰兩區；空地可以丟過去）
      if (regions.length > 1) {
        var link = regions.map(function () { return {}; });
        var linkVia = function (x, y) {
          var hit = [];
          regions.forEach(function (rg, i) { if (touches(rg, x, y)) hit.push(i); });
          for (var a = 0; a < hit.length; a++) for (var b = a + 1; b < hit.length; b++) {
            link[hit[a]][hit[b]] = link[hit[b]][hit[a]] = true;
          }
        };
        cells.forEach(function (row, y) { row.forEach(function (ch, x) {
          if (TILES[ch] && TILES[ch].hold) linkVia(x, y);
        }); });
        // 移動檯面：把整條路線當成一個傳送點
        cells.forEach(function (row, y) { row.forEach(function (ch, x) {
          if (ch !== 'M') return;
          var hit = {};
          moverPath(x, y, props[key(x, y)] || {}).forEach(function (c) {
            regions.forEach(function (rg, i) { if (touches(rg, c[0], c[1])) hit[i] = true; });
          });
          var ids = Object.keys(hit);
          for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) link[ids[a]][ids[b]] = link[ids[b]][ids[a]] = true;
        }); });
        // 空地兩側的區域可以互丟
        cells.forEach(function (row, y) { row.forEach(function (ch, x) {
          if (ch !== ' ') return;
          var hit = {};
          for (var d in DIRS) for (var step = 1; step <= 4; step++) {
            var cx = x + DIRS[d][0] * step, cy = y + DIRS[d][1] * step, t = at(cells, cx, cy);
            if (t === null || t === '#') break;
            if (t === '.') { regions.forEach(function (rg, i) { if (rg[key(cx, cy)]) hit[i] = true; }); break; }
          }
          var ids = Object.keys(hit);
          for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) link[ids[a]][ids[b]] = link[ids[b]][ids[a]] = true;
        }); });
        var seenR = { 0: true }, q = [0];
        while (q.length) { var i = q.shift(); for (var j in link[i]) if (!seenR[j]) { seenR[j] = true; q.push(+j); } }
        if (Object.keys(seenR).length < regions.length) errors.push(tag + '有區域跟其他區域完全傳不了東西');
      }
      // 有工作台沒人走得到（多半是忘了放出生點或被牆擋住）
      var lonely = 0;
      cells.forEach(function (row, y) { row.forEach(function (ch, x) {
        if (TILES[ch] && TILES[ch].station && !touches(all, x, y)) lonely++;
      }); });
      if (lonely) warnings.push(tag + '有 ' + lonely + ' 個工作台沒人走得到');
    }
    // 去掉重複訊息
    var uniq = function (a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); };
    return { errors: uniq(errors), warnings: uniq(warnings) };
  }

  return {
    TILES: TILES, INGREDIENTS: INGREDIENTS, DISHES: DISHES, DIFFICULTY: DIFFICULTY, DIRS: DIRS,
    MIN_SIZE: MIN_SIZE, MAX_SIZE: MAX_SIZE,
    resolve: resolve, validate: validate, starsFor: starsFor, moverPath: moverPath, requirements: requirements
  };
});
