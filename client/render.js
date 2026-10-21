// 展示積木：Three.js 場景（只負責畫，不判定任何規則）
// Render.create(container) → { build(state), draw(prev, cur, alpha, camMode), project(x,y,h) }
(function (root) {
  'use strict';
  var T = root.THREE;

  var COL = {
    bg: 0x1C2A3A, floorA: 0xEADCC2, floorB: 0xE2D2B4, wall: 0x6E5137, wallTop: 0x8A6A4C,
    counter: 0xB98A5E, counterTop: 0xD9B08A, board: 0xF0DDB8, stove: 0x48525F, burner: 0x2B3440,
    pot: 0x9AA7B6, sink: 0xBFD6E8, water: 0x5C95C4, serve: 0xF2B544, trash: 0x6B7684, crate: 0x8F6A43,
    plate: 0xFAF7F0, dirty: 0xA89878, belt: 0x3D6E8F, mover: 0x3F8F7A, window: 0xB9772E, outline: 0x1A1410,
    skin: 0xF2C9A0, hat: 0xFFFFFF, burnt: 0x2A2420
  };
  var PLAYER = [0xC8432C, 0x3B82C4, 0x3FA36B, 0xD9952B, 0x9B6BD1, 0xE77FA6, 0xE8873A, 0x2E9C9C];
  var ING = {
    tomato: { raw: 0xD8402A, cut: 0xE8644C }, lettuce: { raw: 0x6BBF4E, cut: 0x8FD46E },
    onion: { raw: 0xE9D27A, cut: 0xF4E6A8 }, mushroom: { raw: 0xB98B62, cut: 0xD7B48E }, noodle: { raw: 0xF3DFA2, cut: 0xF3DFA2 }
  };
  var SOUP = { tomato: 0xD9502F, onion: 0xE7C35A, mushroom: 0x9C7650 };

  // 三階卡通光影
  var grad = (function () {
    var data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
    var tex = new T.DataTexture(data, 3, 1, T.RGBAFormat);
    tex.minFilter = tex.magFilter = T.NearestFilter; tex.needsUpdate = true; return tex;
  })();
  var matCache = {};
  function mat(color) {
    if (!matCache[color]) matCache[color] = new T.MeshToonMaterial({ color: color, gradientMap: grad });
    return matCache[color];
  }
  var outlineMat = new T.MeshBasicMaterial({ color: COL.outline, side: T.BackSide });
  // 加描邊：同形狀放大一點、只畫背面
  function toon(geo, color, outline) {
    var g = new T.Group(), m = new T.Mesh(geo, mat(color));
    g.add(m);
    if (outline !== false) {
      var o = new T.Mesh(geo, outlineMat);
      o.scale.setScalar(1 + (outline || 0.06));
      g.add(o);
    }
    return g;
  }
  function box(w, h, d, color, ol) { var g = toon(new T.BoxGeometry(w, h, d), color, ol); return g; }
  function cyl(r, h, color, ol, seg) { return toon(new T.CylinderGeometry(r, r, h, seg || 20), color, ol); }
  function sph(r, color, ol) { return toon(new T.SphereGeometry(r, 16, 12), color, ol); }

    var stickerCache = {};
  // 正面貼紙：只畫圖示、畫滿整張（食材箱用食材，回收口用髒盤，盤架用乾淨盤）
  function sticker(name) {
    if (!stickerCache[name]) {
      var cv = document.createElement('canvas'); cv.width = 288; cv.height = 160;
      var c = cv.getContext('2d');
      var hex = function (n) { return '#' + n.toString(16).padStart(6, '0'); };
      c.fillStyle = '#FFF8EC'; c.strokeStyle = '#1A1410'; c.lineWidth = 10;
      if (c.roundRect) { c.beginPath(); c.roundRect(6, 6, 276, 148, 24); c.fill(); c.stroke(); } else { c.fillRect(6, 6, 276, 148); c.strokeRect(6, 6, 276, 148); }
      c.lineWidth = 8; c.lineJoin = 'round';
      var cx = 144, cy = 84;
      var plate = function (x, y, rx, col) { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, rx * 0.42, 0, 0, Math.PI * 2); c.fill(); c.stroke(); };
      if (name === 'dirty' || name === 'clean') {
        var col = name === 'dirty' ? '#A89878' : '#FFFFFF';
        plate(cx, cy + 34, 92, col); plate(cx, cy + 6, 92, col); plate(cx, cy - 22, 92, col);
        if (name === 'dirty') { c.fillStyle = '#6E5A3A'; [[-40, -26], [18, -18], [46, -28], [-10, -30]].forEach(function (d) { c.beginPath(); c.arc(cx + d[0], cy + d[1], 7, 0, 7); c.fill(); }); }
      } else {
        var col2 = hex((ING[name] || { raw: 0xffffff }).raw);
        c.fillStyle = col2; c.beginPath();
        if (name === 'noodle') {
          c.fillStyle = col2; c.fillRect(cx - 80, cy - 46, 160, 92); c.strokeRect(cx - 80, cy - 46, 160, 92);
          c.strokeStyle = '#C9A960'; c.lineWidth = 6;
          for (var w = 0; w < 4; w++) { c.beginPath(); c.moveTo(cx - 70, cy - 30 + w * 20); c.bezierCurveTo(cx - 30, cy - 44 + w * 20, cx + 10, cy - 16 + w * 20, cx + 70, cy - 30 + w * 20); c.stroke(); }
        } else if (name === 'mushroom') {
          c.fillStyle = '#F2E6D0'; c.fillRect(cx - 18, cy - 4, 36, 60); c.strokeRect(cx - 18, cy - 4, 36, 60);
          c.fillStyle = col2; c.beginPath(); c.arc(cx, cy, 70, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
        } else if (name === 'lettuce') {
          c.arc(cx, cy + 6, 62, 0, Math.PI * 2); c.fill(); c.stroke();
          c.strokeStyle = '#3F8F3A'; c.lineWidth = 6; c.beginPath(); c.moveTo(cx, cy - 50); c.lineTo(cx, cy + 60); c.moveTo(cx, cy); c.lineTo(cx - 36, cy - 28); c.moveTo(cx, cy + 22); c.lineTo(cx + 38, cy - 8); c.stroke();
        } else if (name === 'onion') {
          c.moveTo(cx, cy - 66); c.quadraticCurveTo(cx + 70, cy - 10, cx + 50, cy + 44); c.quadraticCurveTo(cx, cy + 70, cx - 50, cy + 44); c.quadraticCurveTo(cx - 70, cy - 10, cx, cy - 66); c.fill(); c.stroke();
          c.strokeStyle = '#B89A40'; c.lineWidth = 5; c.beginPath(); c.moveTo(cx, cy - 56); c.lineTo(cx, cy + 56); c.moveTo(cx - 22, cy - 40); c.quadraticCurveTo(cx - 34, cy + 10, cx - 20, cy + 52); c.moveTo(cx + 22, cy - 40); c.quadraticCurveTo(cx + 34, cy + 10, cx + 20, cy + 52); c.stroke();
        } else {
          c.arc(cx, cy + 8, 62, 0, Math.PI * 2); c.fill(); c.stroke();
          c.fillStyle = '#3F8F3A'; c.beginPath(); c.moveTo(cx, cy - 60); c.lineTo(cx - 30, cy - 46); c.lineTo(cx, cy - 40); c.lineTo(cx + 30, cy - 46); c.closePath(); c.fill(); c.stroke();
          c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(cx - 26, cy - 10, 14, 9, -0.6, 0, 7); c.fill();
        }
      }
      var tex = new T.CanvasTexture(cv); tex.anisotropy = 4;
      stickerCache[name] = new T.MeshBasicMaterial({ map: tex });
    }
    return new T.Mesh(new T.PlaneGeometry(0.92, 0.51), stickerCache[name]);
  }

  var CH = 0.55; // 檯面高度（壓低，俯視才看得到出入口）
  var WALL_H = 0.42; // 牆高度（比檯面還矮，只當邊界）
  var ING_SCALE = 1.75, PLATE_SCALE = 1.3; // 食材、盤子放大，遠看也認得出來

  function create(container) {
    var renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(COL.bg);
    container.appendChild(renderer.domElement);
    var scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x8a7a6a, 0.5));
    var sun = new T.DirectionalLight(0xffffff, 0.55); sun.position.set(-4, 10, 6); scene.add(sun);
    var camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
    var world = new T.Group(); scene.add(world);
    var dyn = new T.Group(); scene.add(dyn);
    var W = 10, H = 10, cells = [];
    var playerMeshes = [], itemMeshes = {}, tileDyn = {};
    var camPos = new T.Vector3(), camLook = new T.Vector3(), camInit = false;
    // 目標格子的黃框（按鍵會作用在這一格）
    var hl = new T.Group();
    var hlMat = new T.MeshBasicMaterial({ color: 0xFFD54A, transparent: true, opacity: 0.9, depthTest: false });
    [[0, -0.47, 1, 0.08], [0, 0.47, 1, 0.08], [-0.47, 0, 0.08, 1], [0.47, 0, 0.08, 1]].forEach(function (e) {
      var m = new T.Mesh(new T.PlaneGeometry(e[2], e[3]), hlMat); m.rotation.x = -Math.PI / 2; m.position.set(e[0], 0, e[1]); m.renderOrder = 10; hl.add(m);
    });
    hl.visible = false; scene.add(hl);
    function setTarget(cell, floor) {
      if (cell) { hl.visible = true; hl.position.set(cell[0] + 0.5, CH + 0.09, cell[1] + 0.5); hl.scale.setScalar(1); }
      else if (floor) { hl.visible = true; hl.position.set(floor[0], 0.04, floor[1]); hl.scale.setScalar(0.6); }
      else hl.visible = false;
    }

    function resize() {
      var w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    // 貼紙貼在面向走道的那一面；朝鏡頭（南）優先，背對鏡頭的面看不到就改貼左右側
    function placeSticker(m, x, y) {
      var dirs = [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, -1, Math.PI]];
      var d = dirs.find(function (q) { var r = cells[y + q[1]]; return r && r[x + q[0]] === '.'; }) || dirs[0];
      m.position.set(x + 0.5 + d[0] * 0.505, CH * 0.48, y + 0.5 + d[1] * 0.505);
      m.rotation.y = d[2];
      world.add(m);
    }
    function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

    // ── 靜態廚房 ──
    function build(state) {
      clearGroup(world); clearGroup(dyn);
      playerMeshes = []; itemMeshes = {}; tileDyn = {}; camInit = false;
      W = state.w; H = state.h; cells = state.cells;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var ch = cells[y][x], cx = x + 0.5, cz = y + 0.5, g = null;
        if (ch === ' ') continue;
        var fl = new T.Mesh(new T.PlaneGeometry(1, 1), mat((x + y) % 2 ? COL.floorA : COL.floorB));
        fl.rotation.x = -Math.PI / 2; fl.position.set(cx, 0, cz); world.add(fl);
        if (ch === '.') continue;
        if (ch === '#') { g = box(1, WALL_H, 1, COL.wall, 0.02); g.position.set(cx, WALL_H / 2, cz); world.add(g); var cap = box(1, 0.04, 1, COL.wallTop, false); cap.position.set(cx, WALL_H + 0.02, cz); world.add(cap); continue; }
        // 所有工作台先有一個檯面座
        var baseCol = { V: COL.belt, M: COL.mover, W: COL.window, S: COL.stove, T: COL.trash, I: COL.crate, K: COL.counter, O: COL.serve }[ch] || COL.counter;
        if (ch === 'T') { g = cyl(0.4, CH, COL.trash, 0.05); g.position.set(cx, CH / 2, cz); world.add(g); var lid = cyl(0.3, 0.03, 0x2B3440, false); lid.position.set(cx, CH + 0.02, cz); world.add(lid); continue; }
        g = box(0.98, CH, 0.98, baseCol, 0.03); g.position.set(cx, CH / 2, cz); world.add(g);
        var top = null;
        if (ch === 'C' || ch === 'P') { top = box(1, 0.06, 1, COL.counterTop, false); }
        if (ch === 'R') {                                     // 回收口：上面是凹下去的出口，不能放東西
          top = box(1, 0.06, 1, 0x5E4632, false);
          var slot = box(0.78, 0.03, 0.78, 0x2B2018, false); slot.position.y = 0.03; top.add(slot);
        }
        if (ch === 'R' || ch === 'P') placeSticker(sticker(ch === 'R' ? 'dirty' : 'clean'), x, y);
        if (ch === 'R') {                                     // 回收口上面也畫圖示（貼在凹槽裡），哪個角度都看得到
          var dec = sticker('dirty'); dec.scale.set(0.82, 1.45, 1); dec.rotation.x = -Math.PI / 2; dec.position.set(cx, CH + 0.08, cz); world.add(dec);
        }
        if (ch === 'B') { top = box(0.8, 0.06, 0.6, COL.board, 0.06); var knife = box(0.08, 0.03, 0.42, 0x9AA7B6, false); knife.position.set(0.3, 0.06, 0); top.add(knife); }
        if (ch === 'S') { top = cyl(0.36, 0.04, COL.burner, false); var pot = cyl(0.33, 0.32, COL.pot, 0.05); pot.position.y = 0.18; top.add(pot); }
        if (ch === 'K') { top = box(0.8, 0.08, 0.8, COL.sink, 0.04); var w2 = box(0.6, 0.02, 0.6, COL.water, false); w2.position.y = 0.05; top.add(w2); }
        if (ch === 'O') { top = box(1, 0.06, 1, 0xFFD27A, false); var bell = sph(0.14, 0xD9952B, 0.08); bell.position.set(0.3, 0.12, -0.3); top.add(bell); }
        if (ch === 'I') {
          // 箱子：上面是平台（可以放東西），正面貼食材貼紙
          top = box(1, 0.06, 1, COL.counterTop, false);
          var item = (state.tiles[x + ',' + y] || {}).item;
          placeSticker(sticker(item), x, y);
        }
        if (ch === 'V') { top = box(1, 0.05, 0.7, 0x2B4A60, false); }
        if (ch === 'W') { top = box(1, 0.06, 1, 0xD49A52, false); }
        if (top) { top.position.set(cx, CH + 0.03, cz); world.add(top); }
        // 會變動的格子內容
        if ('PRKS'.indexOf(ch) >= 0) { var dg = new T.Group(); dg.position.set(cx, CH + 0.06, cz); dyn.add(dg); tileDyn[x + ',' + y] = { ch: ch, g: dg, sig: '' }; }
      }
      state.players.forEach(function (p, i) { var m = makePlayer(i); dyn.add(m); playerMeshes.push(m); });
      resize();
    }

    function makePlayer(i) {
      var g = new T.Group();
      var body = cyl(0.3, 0.6, PLAYER[i % 8], 0.06); body.position.y = 0.4; g.add(body);
      var apron = box(0.34, 0.4, 0.08, 0xFFFFFF, false); apron.position.set(0, 0.38, 0.29); g.add(apron);
      var head = sph(0.24, COL.skin, 0.06); head.position.y = 0.92; g.add(head);
      var hat = cyl(0.19, 0.24, COL.hat, 0.06); hat.position.y = 1.2; g.add(hat);
      var puff = sph(0.22, COL.hat, 0.05); puff.position.y = 1.36; g.add(puff);
      var eyeL = sph(0.035, 0x1C2A3A, false); eyeL.position.set(-0.08, 0.95, 0.21); g.add(eyeL);
      var eyeR = sph(0.035, 0x1C2A3A, false); eyeR.position.set(0.08, 0.95, 0.21); g.add(eyeR);
      var ring = new T.Mesh(new T.RingGeometry(0.36, 0.44, 24), new T.MeshBasicMaterial({ color: PLAYER[i % 8] }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
      return g;
    }

    // ── 東西的模型 ──
    function itemSig(it) { return it.kind === 'plate' ? 'p' + (it.dirty ? 'd' : '') + (it.n || 1) + it.contents.join(',') : it.name + it.state; }
    function makeItem(it) {
      var g = makeItemRaw(it);
      g.scale.setScalar(it.kind === 'plate' ? PLATE_SCALE : ING_SCALE);
      return g;
    }
    function makeItemRaw(it) {
      var g = new T.Group();
      if (it.kind === 'plate') {
        var cnt = Math.min(it.n || 1, 8);
        for (var k = 0; k < cnt; k++) { var pl = cyl(0.3, 0.05, it.dirty ? COL.dirty : COL.plate, 0.06, 24); pl.position.y = k * 0.07; g.add(pl); }
        if (cnt > 1) return g;
        it.contents.forEach(function (c, i) {
          var a = c.split(':'), m;
          if (a[0] === 'soup') { m = cyl(0.22, 0.08, SOUP[a[1]], false, 20); m.position.y = 0.06; }
          else if (a[0] === 'noodle') { m = cyl(0.2, 0.1, ING.noodle.raw, 0.08, 12); m.position.y = 0.07; }
          else { m = box(0.18, 0.06, 0.12, ING[a[0]].cut, 0.08); m.position.set(-0.08 + i * 0.16, 0.06, 0.04 - i * 0.08); }
          g.add(m);
        });
        return g;
      }
      var c = ING[it.name][it.state];
      if (it.state === 'cut') {
        for (var i = 0; i < 3; i++) { var s = box(0.16, 0.06, 0.1, c, 0.1); s.position.set(-0.12 + i * 0.12, 0.04, (i % 2) * 0.08); s.rotation.y = i * 0.5; g.add(s); }
      } else if (it.name === 'noodle') {
        var n = box(0.32, 0.1, 0.24, c, 0.06); n.position.y = 0.06; g.add(n);
      } else if (it.name === 'lettuce') {
        var l = sph(0.2, c, 0.06); l.scale.y = 0.75; l.position.y = 0.14; g.add(l);
      } else if (it.name === 'mushroom') {
        var cap = sph(0.17, c, 0.07); cap.scale.y = 0.6; cap.position.y = 0.2; g.add(cap);
        var st = cyl(0.07, 0.16, 0xF2E6D0, 0.08); st.position.y = 0.08; g.add(st);
      } else {
        var b = sph(0.17, c, 0.07); b.position.y = 0.16; g.add(b);
        var leaf = box(0.08, 0.04, 0.08, 0x3F8F3A, false); leaf.position.y = 0.33; g.add(leaf);
      }
      return g;
    }

    // 東西的世界座標
    function itemPos(state, it, players) {
      var a = it.at;
      if (a.hand != null) {
        var p = players[a.hand];
        return [p.x + p.fx * 0.5, 0.62, p.y + p.fy * 0.5];
      }
      if (a.tile) { var xy = a.tile.split(','); return [+xy[0] + 0.5, CH + 0.06, +xy[1] + 0.5]; }
      if (a.floor) return [a.floor[0], 0.02, a.floor[1]];
      if (a.air) return [a.air.x, Math.max(0.02, a.air.h), a.air.y];
      return [0, -10, 0];
    }

    function lerp(a, b, t) { return a + (b - a) * t; }
    function lerpPlayers(prev, cur, alpha) {
      return cur.players.map(function (p, i) {
        var q = prev && prev.players[i] ? prev.players[i] : p;
        var fx = lerp(q.fx, p.fx, alpha), fy = lerp(q.fy, p.fy, alpha), fl = Math.hypot(fx, fy) || 1;
        return { x: lerp(q.x, p.x, alpha), y: lerp(q.y, p.y, alpha), fx: fx / fl, fy: fy / fl };
      });
    }

    // ── 每一幀 ──
    function draw(prev, cur, alpha, camMode, me) {
      var players = lerpPlayers(prev, cur, alpha);
      players.forEach(function (p, i) {
        var m = playerMeshes[i]; if (!m) return;
        m.position.set(p.x, 0, p.y);
        m.rotation.y = Math.atan2(p.fx, p.fy);
        var busy = cur.players[i].busy;
        m.children[0].position.y = 0.4 + (busy ? Math.abs(Math.sin(performance.now() / 90)) * 0.05 : 0);
      });

      // 東西：新增、更新、移除
      var seen = {};
      for (var id in cur.items) {
        var it = cur.items[id], sig = itemSig(it), rec = itemMeshes[id];
        if (!rec || rec.sig !== sig) { if (rec) { dyn.remove(rec.g); if (rec.shadow) dyn.remove(rec.shadow); } rec = itemMeshes[id] = { g: makeItem(it), sig: sig }; dyn.add(rec.g); }
        var pos = itemPos(cur, it, players);
        // 飛行、落地滑行時用上一個 tick 的位置內插，動起來才連續
        var pi = prev && prev.items[id];
        if (pi && it.at.hand == null && pi.at.hand == null && (it.at.air || pi.at.air || it.at.slide || pi.at.slide)) {
          var pp = itemPos(prev, pi, players);
          pos = [lerp(pp[0], pos[0], alpha), lerp(pp[1], pos[1], alpha), lerp(pp[2], pos[2], alpha)];
        }
        rec.g.position.set(pos[0], pos[1], pos[2]);
        if (it.at.air) { rec.g.rotation.x += 0.35; rec.g.rotation.z += 0.2; }   // 飛行中翻轉
        if (it.at.air) {
          if (!rec.shadow) { rec.shadow = new T.Mesh(new T.CircleGeometry(0.28, 20), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })); rec.shadow.rotation.x = -Math.PI / 2; dyn.add(rec.shadow); }
          rec.shadow.visible = true; rec.shadow.position.set(pos[0], 0.015, pos[2]);
          var sc = Math.max(0.4, 1 - pos[1] * 0.3); rec.shadow.scale.set(sc, sc, sc);
        } else if (rec.shadow) rec.shadow.visible = false;
        else if (!it.at.slide) { rec.g.rotation.x = 0; rec.g.rotation.z = 0; }
        seen[id] = true;
      }
      for (var k in itemMeshes) if (!seen[k]) { dyn.remove(itemMeshes[k].g); if (itemMeshes[k].shadow) dyn.remove(itemMeshes[k].shadow); delete itemMeshes[k]; }

      // 格子內容（盤架、回收口、水槽的盤子數，鍋子內容）
      for (var tk in tileDyn) {
        var td = tileDyn[tk], t = cur.tiles[tk], s2 = '';
        if (td.ch === 'P') s2 = 'c' + t.clean;
        if (td.ch === 'R') s2 = 'd' + t.dirty;
        if (td.ch === 'K') s2 = 'd' + t.dirty + 'c' + t.clean;
        if (td.ch === 'S') s2 = t.pot.contents.join(',') + (t.pot.burnt ? 'B' : '') + (window.Game.potReady(t.pot) ? 'R' : '');
        if (s2 === td.sig) continue;
        td.sig = s2; clearGroup(td.g);
        if (td.ch === 'P') for (var i = 0; i < Math.min(t.clean, 8); i++) { var pl = cyl(0.3, 0.05, COL.plate, 0.05, 24); pl.position.y = 0.03 + i * 0.06; td.g.add(pl); }
        if (td.ch === 'R') for (var j = 0; j < Math.min(t.dirty, 8); j++) { var dp = cyl(0.3, 0.05, COL.dirty, 0.05, 24); dp.position.y = 0.03 + j * 0.06; td.g.add(dp); }
        if (td.ch === 'K') {
          for (var q = 0; q < Math.min(t.dirty, 4); q++) { var sp = cyl(0.22, 0.04, COL.dirty, false, 20); sp.position.set(-0.1, 0.04 + q * 0.05, -0.05); sp.rotation.x = 0.3; td.g.add(sp); }
          // 洗好的盤子疊在水槽旁（右前角）
          for (var cq = 0; cq < Math.min(t.clean, 8); cq++) { var cp = cyl(0.2, 0.04, COL.plate, 0.06, 20); cp.position.set(0.24, 0.05 + cq * 0.05, 0.24); td.g.add(cp); }
        }
        if (td.ch === 'S') {
          var pot = t.pot, n = pot.contents.length;
          if (n) {
            var col = pot.burnt ? COL.burnt : window.Game.potReady(pot) ? (pot.contents[0] === 'noodle' ? ING.noodle.raw : SOUP[pot.contents[0]]) : ING[pot.contents[0]].cut;
            var fill = cyl(0.29, 0.04, col, false, 20); fill.position.y = 0.06 + Math.min(n, 3) * 0.07; td.g.add(fill);
          }
        }
      }

      // 鏡頭
      var p0 = players[me] || players[0];
      var target = new T.Vector3(), pos3 = new T.Vector3();
      if (camMode === 'follow' && p0) {
        target.set(p0.x + p0.fx * 0.6, 0, p0.y + p0.fy * 0.6);
        pos3.set(target.x, 6.6, target.z + 5.4);
      } else {
        var cx = W / 2, cz = H / 2;
        var vfov = camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
        var needW = (W + 0.4) / 2 / Math.tan(hfov / 2), needH = (H + 1.5) / 2 / Math.tan(vfov / 2) * 0.7;
        var dist = Math.max(needW, needH, 8);
        target.set(cx, 0, cz + 0.1);
        pos3.set(cx, dist * 0.8, cz + dist * 0.6);   // 約 53°，看得到工作台正面的貼紙
      }
      if (!camInit) { camPos.copy(pos3); camLook.copy(target); camInit = true; }
      camPos.lerp(pos3, 0.12); camLook.lerp(target, 0.12);
      camera.position.copy(camPos); camera.lookAt(camLook);
      hlMat.opacity = 0.6 + Math.sin(performance.now() / 160) * 0.3;
      renderer.render(scene, camera);
      return players;
    }

    // 世界座標 → 畫面座標（給進度條等 DOM 用）
    var v = new T.Vector3();
    function project(x, h, z) {
      v.set(x, h, z).project(camera);
      return { x: (v.x + 1) / 2 * container.clientWidth, y: (1 - v.y) / 2 * container.clientHeight, behind: v.z > 1 };
    }

    resize();
    return { build: build, draw: draw, project: project, resize: resize, setTarget: setTarget, CH: CH, PLAYER: PLAYER };
  }

  root.Render = { create: create };
})(typeof self !== 'undefined' ? self : this);
