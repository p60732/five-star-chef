// 入口 + 展示 + 連線（M0 單機版：沒有伺服器，直接在本機跑規則引擎）
(function () {
  'use strict';
  var Game = window.Game, Level = window.Level;
  var LEVELS = window.LEVELS;
  var STEP = 0.05;                        // 跟伺服器一樣 20 tick/秒
  var SETTINGS_KEY = 'coopk.settings';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var settings = { cam: 'top' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) {}
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }

  var desc = null;            // 「面前是什麼、按鍵會做什麼」，每個 tick 算一次
  var R = null, cur = null, prev = null, level = null, acc = 0, last = 0, running = false, paused = false;
  var input = { mx: 0, my: 0, grab: false, throw: false, use: false };
  var key = { up: 0, down: 0, left: 0, right: 0 };

  // ── 畫面切換 ──
  function show(id) { ['menu', 'play', 'end'].forEach(function (s) { $(s).hidden = s !== id; }); }

  function buildMenu() {
    var list = $('levels'); list.textContent = '';
    LEVELS.forEach(function (lv, i) {
      var b = el('button', 'lv');
      var mech = /[VMW]/.test(lv.grid.join(''));
      b.appendChild(el('span', 'lv-id', lv.id));
      var info = el('span', 'lv-info');
      info.appendChild(el('span', 'lv-name', lv.name));
      info.appendChild(el('span', 'lv-sub', lv.dishes.map(function (d) { return Level.DISHES[d].name; }).join('・') + (mech ? '　機關還不會動' : '')));
      b.appendChild(info);
      if (i === 0) b.appendChild(el('span', 'lv-tag', '先玩這關'));
      b.addEventListener('click', function () { start(lv); });
      list.appendChild(b);
    });
  }

  // ── 開局 ──
  function start(lv) {
    level = lv;
    cur = Game.createGame(lv, 1, (Date.now() & 0x7fffffff) || 1);
    prev = cur;
    show('play');
    if (!R) R = window.Render.create($('stage'));
    R.build(cur);
    $('bars').textContent = ''; barPool = {};
    $('floats').textContent = '';
    setCam(settings.cam);
    acc = 0; last = performance.now(); running = true; paused = false; $('pause').hidden = true;
    requestAnimationFrame(frame);
    if (lv.id === '1-1') toast('先到上面的番茄箱前按「拿」', 3200);
  }

  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (!paused) {
      acc += dt;
      while (acc >= STEP) {
        var mx = input.mx + (key.right - key.left), my = input.my + (key.down - key.up);
        var inp = { mx: mx, my: my, grab: input.grab, throw: input.throw, use: input.use };
        input.grab = false; input.throw = false;
        prev = cur; cur = Game.step(cur, { 0: inp }, STEP);
        handleEvents(cur.events);
        desc = null;
        acc -= STEP;
        if (cur.ended) { running = false; setTimeout(showEnd, 600); break; }
      }
    }
    var players = R.draw(prev, cur, paused ? 1 : acc / STEP, settings.cam, 0);
    drawHud(players);
    requestAnimationFrame(frame);
  }

  // ── 事件回饋 ──
  var DISH = function (d) { return Level.DISHES[d].name; };
  function handleEvents(evs) {
    evs.forEach(function (e) {
      if (e.t === 'served') { floatAtPlayer(e.pid, '+' + e.points, 'good'); toast(DISH(e.dish) + ' 出餐！'); }
      if (e.t === 'wrong') toast('沒有這道菜的訂單');
      if (e.t === 'expired') toast(DISH(e.dish) + ' 等太久，客人走了 −' + Game.CFG.expirePenalty);
      if (e.t === 'burnt') toast('鍋子燒焦了！走到鍋子前按「切/互動」清掉');
      if (e.t === 'order') pulse('orders');
      if (e.t === 'chopped') floatAtPlayer(e.pid, '切好了', '');
      if (e.t === 'washed') floatAtPlayer(e.pid, '洗好了', '');
      if (e.t === 'plateBack') pulse('hint');
    });
  }
  function floatAtPlayer(pid, text, cls) {
    var p = cur.players[pid]; if (!p || !R) return;
    var s = R.project(p.x, 1.8, p.y);
    var f = el('div', 'float ' + cls, text);
    f.style.left = s.x + 'px'; f.style.top = s.y + 'px';
    $('floats').appendChild(f);
    setTimeout(function () { f.remove(); }, 1100);
  }
  var toastT = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 2000);
  }
  function pulse(id) { var e = $(id); e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); }

  // ── HUD ──
  var lastHud = '';
  var ING_CHIP = { 'lettuce:cut': ['生菜', '#6BBF4E'], 'tomato:cut': ['番茄', '#D8402A'], 'soup:tomato': ['番茄×3', '#D8402A'], 'soup:onion': ['洋蔥×3', '#C9A93A'], 'soup:mushroom': ['蘑菇×3', '#9C7650'], 'noodle:cooked': ['麵', '#C9A960'] };
  function drawHud(players) {
    var t = Math.ceil(cur.timeLeft), mm = Math.floor(t / 60), ss = t % 60;
    $('timer').textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    $('timer').classList.toggle('low', t <= 20);
    $('score').textContent = cur.score;

    var sig = cur.orders.map(function (o) { return o.id; }).join(',');
    if (sig !== lastHud) {
      lastHud = sig;
      var box = $('orders'); box.textContent = '';
      if (!cur.orders.length) box.appendChild(el('div', 'order empty', '等客人點餐…'));
      cur.orders.forEach(function (o) {
        var c = el('div', 'order'); c.dataset.id = o.id;
        c.appendChild(el('div', 'o-name', DISH(o.dish)));
        var chips = el('div', 'o-chips');
        Game.SIGNATURE[o.dish].forEach(function (x) { var ch = el('span', 'chip', ING_CHIP[x][0]); ch.style.setProperty('--c', ING_CHIP[x][1]); chips.appendChild(ch); });
        c.appendChild(chips);
        var bar = el('div', 'o-bar'); bar.appendChild(el('div', 'o-fill')); c.appendChild(bar);
        box.appendChild(c);
      });
    }
    Array.prototype.forEach.call($('orders').querySelectorAll('.order[data-id]'), function (c) {
      var o = cur.orders.find(function (x) { return String(x.id) === c.dataset.id; }); if (!o) return;
      var r = o.timeLeft / o.total, f = c.querySelector('.o-fill');
      f.style.width = (r * 100) + '%'; f.className = 'o-fill' + (r < 0.25 ? ' bad' : r < 0.5 ? ' mid' : '');
    });

    // 提示列與按鈕文字
    var d = desc || (desc = Game.describe(cur, 0));
    R.setTarget(d.cell, d.floor);
    var parts = [];
    if (d.holding) parts.push('手上：' + d.holding);
    if (d.target) parts.push('面前：' + d.target);
    $('hint').textContent = parts.join('　') || '用左下角搖桿走到工作台前面';
    $('gSub').textContent = d.grab || '—';
    $('uSub').textContent = d.use || '—';
    $('btnGrab').classList.toggle('dim', !d.grab);
    $('btnUse').classList.toggle('dim', !d.use);
    $('btnThrow').classList.toggle('dim', !d.canThrow);

    drawBars();
  }

  // 進度條：切、洗、煮
  var barPool = {};
  function bar(id, x, h, z, ratio, kind, label) {
    var b = barPool[id];
    if (!b) { b = barPool[id] = el('div', 'pbar'); b.appendChild(el('div', 'pfill')); b.appendChild(el('span', 'plabel')); $('bars').appendChild(b); }
    var s = R.project(x, h, z);
    b.style.left = s.x + 'px'; b.style.top = s.y + 'px';
    b.firstChild.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
    b.className = 'pbar ' + (kind || '');
    b.lastChild.textContent = label || '';
    b._seen = true;
  }
  function drawBars() {
    for (var k in barPool) barPool[k]._seen = false;
    var C = Game.CFG;
    for (var id in cur.items) {
      var it = cur.items[id];
      if (it.kind === 'ing' && it.state === 'raw' && it.chop > 0 && it.at.tile) {
        var xy = it.at.tile.split(','); bar('c' + id, +xy[0] + 0.5, 1.25, +xy[1] + 0.5, it.chop, 'chop');
      }
    }
    for (var tk in cur.tiles) {
      var t = cur.tiles[tk], a = tk.split(','), x = +a[0] + 0.5, z = +a[1] + 0.5;
      if (t.wash > 0) bar('w' + tk, x, 1.2, z, t.wash, 'wash');
      if (t.pot) {
        var pot = t.pot;
        if (pot.burnt) bar('p' + tk, x, 1.35, z, 1, 'burnt', '燒焦');
        else if (Game.potComplete(pot)) {
          if (pot.cook < C.cookSec) bar('p' + tk, x, 1.35, z, pot.cook / C.cookSec, 'cook');
          else bar('p' + tk, x, 1.35, z, 1 - (pot.cook - C.cookSec) / C.burnSec, (pot.cook - C.cookSec) > C.burnSec * 0.5 ? 'warn' : 'ready', '好了');
        } else if (pot.contents.length) bar('p' + tk, x, 1.35, z, pot.contents.length / C.soupSize, 'partial', pot.contents.length + '/' + C.soupSize);
      }
    }
    for (var k2 in barPool) if (!barPool[k2]._seen) { barPool[k2].remove(); delete barPool[k2]; }
  }

  // ── 結算 ──
  function showEnd() {
    show('end');
    var st = cur.stats, stars = cur.stars.filter(function (v) { return cur.score >= v; }).length;
    $('endLevel').textContent = level.id + ' ' + level.name + '・1 人';
    $('endScore').textContent = cur.score;
    var starBox = $('endStars'); starBox.textContent = '';
    for (var i = 0; i < 3; i++) starBox.appendChild(el('span', 'star' + (i < stars ? ' on' : ''), '★'));
    starBox.setAttribute('aria-label', '拿到 ' + stars + ' 顆星');
    var next = cur.stars.find(function (v) { return v > cur.score; });
    $('endNext').textContent = next ? '再 ' + (next - cur.score) + ' 分拿下一顆星（門檻 ' + cur.stars.join(' / ') + '）' : '三顆星滿分！';
    $('eServed').textContent = '出餐 ' + st.served + ' 道'; $('eBase').textContent = '+' + st.base;
    $('eTips').textContent = '+' + st.tips;
    $('eFailed').textContent = '逾時 ' + st.failed + ' 道'; $('ePenalty').textContent = '−' + st.penalty;
    $('eTotal').textContent = cur.score;
  }

  // ── 鏡頭 ──
  function setCam(m) {
    settings.cam = m; saveSettings();
    $('camTop').setAttribute('aria-pressed', String(m === 'top'));
    $('camFollow').setAttribute('aria-pressed', String(m === 'follow'));
  }
  $('camTop').addEventListener('click', function () { setCam('top'); });
  $('camFollow').addEventListener('click', function () { setCam('follow'); });

  // ── 暫停 ──
  $('btnPause').addEventListener('click', function () { paused = true; $('pause').hidden = false; });
  $('resume').addEventListener('click', function () { paused = false; last = performance.now(); $('pause').hidden = true; });
  $('quit').addEventListener('click', function () { running = false; show('menu'); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && running) { paused = true; $('pause').hidden = false; } });
  $('again').addEventListener('click', function () { start(level); });
  $('toMenu').addEventListener('click', function () { show('menu'); });

  // ── 搖桿（浮動：在左半邊哪裡按下，搖桿就出現在哪裡）──
  var joy = $('joy'), knob = $('knob'), joyId = null, jx = 0, jy = 0, R_JOY = 56;
  var pad = $('padArea');
  pad.addEventListener('pointerdown', function (e) {
    if (joyId !== null) return;
    joyId = e.pointerId; jx = e.clientX; jy = e.clientY;
    joy.hidden = false; joy.style.left = jx + 'px'; joy.style.top = jy + 'px'; knob.style.transform = 'translate(-50%,-50%)';
    pad.setPointerCapture(e.pointerId); e.preventDefault();
  });
  pad.addEventListener('pointermove', function (e) {
    if (e.pointerId !== joyId) return;
    var dx = e.clientX - jx, dy = e.clientY - jy, l = Math.hypot(dx, dy);
    if (l > R_JOY) { dx = dx / l * R_JOY; dy = dy / l * R_JOY; }
    knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    input.mx = dx / R_JOY; input.my = dy / R_JOY;
  });
  function joyEnd(e) { if (e.pointerId !== joyId) return; joyId = null; input.mx = input.my = 0; joy.hidden = true; }
  pad.addEventListener('pointerup', joyEnd); pad.addEventListener('pointercancel', joyEnd);

  // ── 三顆鍵 ──
  function bindBtn(id, onDown, onUp) {
    var b = $(id);
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('down'); onDown(); try { b.setPointerCapture(e.pointerId); } catch (x) {} });
    var up = function () { b.classList.remove('down'); if (onUp) onUp(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  bindBtn('btnGrab', function () { input.grab = true; });
  bindBtn('btnUse', function () { input.use = true; }, function () { input.use = false; });
  bindBtn('btnThrow', function () { input.throw = true; });

  // ── 鍵盤（電腦）──
  var KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', function (e) {
    if ($('play').hidden) return;
    if (KEYS[e.code]) { key[KEYS[e.code]] = 1; e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'KeyJ' || e.code === 'Space') { input.grab = true; e.preventDefault(); }
    if (e.code === 'KeyK') input.use = true;
    if (e.code === 'KeyL') input.throw = true;
    if (e.code === 'KeyC') setCam(settings.cam === 'top' ? 'follow' : 'top');
  });
  window.addEventListener('keyup', function (e) {
    if (KEYS[e.code]) key[KEYS[e.code]] = 0;
    if (e.code === 'KeyK') input.use = false;
  });
  window.addEventListener('blur', function () { key.up = key.down = key.left = key.right = 0; input.use = false; });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  buildMenu(); show('menu');
})();
