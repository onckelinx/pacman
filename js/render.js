/* Pac-Man — draws a game state onto a canvas. It only ever reads the state. */
(function () {
  'use strict';

  var R = PM.rules;
  var G = PM.game;
  var COLS = R.COLS, ROWS = R.ROWS;
  var PI = Math.PI;

  var MIN_TILE = 8;         // device pixels
  var PAC_RADIUS = 0.8;     // in tiles
  var GHOST_RADIUS = 0.85;
  var MOUTH_CYCLE = 12;     // pixels travelled per open-and-close of the mouth
  var MOUTH_WIDEST = 0.9;   // half-angle in radians
  var DIR_ANGLE = [-PI / 2, PI, PI / 2, 0];
  var WALL_FLASH_AFTER = 60; // ticks into the level-clear pause
  var GHOSTS_GONE_AFTER = 60;

  // ---- Fitting the window ----

  // The largest whole number of device pixels per tile that fits. Whole numbers keep the
  // maze crisp at any display scale, including fractional ones such as 1.25.
  function fit(availW, availH, dpr) {
    var T = Math.floor(Math.min(availW * dpr / COLS, availH * dpr / ROWS));
    T = Math.max(T, MIN_TILE);
    return {
      T: T,
      width: COLS * T,
      height: ROWS * T,
      cssWidth: COLS * T / dpr,
      cssHeight: ROWS * T / dpr
    };
  }

  function readPalette() {
    var css = getComputedStyle(document.documentElement);
    function v(name) { return css.getPropertyValue(name).trim(); }
    return {
      mazeBg: v('--maze-bg'),
      wall: v('--wall'),
      wallFlash: v('--wall-flash'),
      door: v('--door'),
      dot: v('--dot'),
      pac: v('--pac'),
      ghosts: [v('--blinky'), v('--pinky'), v('--inky'), v('--clyde')],
      fright: v('--fright'),
      frightFlash: v('--fright-flash'),
      frightFace: v('--fright-face'),
      frightFlashFace: v('--fright-flash-face'),
      eye: v('--eye'),
      pupil: v('--pupil'),
      ready: v('--ready'),
      over: v('--over'),
      popup: v('--popup'),
      panel: v('--panel'),
      panelText: v('--panel-text'),
      red: v('--fruit-red'),
      green: v('--fruit-green'),
      orange: v('--fruit-orange'),
      yellow: v('--fruit-yellow'),
      white: v('--fruit-white')
    };
  }

  // ---- The maze ----

  // Walls are drawn half a tile back from the corridors, as in the arcade game, so the
  // corridors look two tiles wide. This is worked out on a half-tile grid from the same
  // map that collisions use, so the picture cannot disagree with the game.
  var FILLED = (function () {
    var grid = [];
    for (var hy = 0; hy < ROWS * 2; hy++) {
      for (var hx = 0; hx < COLS * 2; hx++) {
        var solid = true;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!R.isWall(Math.floor((hx + dx) / 2), Math.floor((hy + dy) / 2))) solid = false;
          }
        }
        grid.push(solid);
      }
    }
    return grid;
  })();

  function filled(hx, hy) {
    if (hx < 0 || hy < 0 || hx >= COLS * 2 || hy >= ROWS * 2) return true;
    return FILLED[hy * COLS * 2 + hx];
  }

  // One solid half-tile cell, with an outside corner rounded where both sides are open.
  function solidCell(ctx, x0, y0, x1, y1, r, tl, tr, br, bl) {
    ctx.beginPath();
    ctx.moveTo(x0 + (tl ? r : 0), y0);
    ctx.lineTo(x1 - (tr ? r : 0), y0);
    if (tr) ctx.arc(x1 - r, y0 + r, r, -PI / 2, 0);
    ctx.lineTo(x1, y1 - (br ? r : 0));
    if (br) ctx.arc(x1 - r, y1 - r, r, 0, PI / 2);
    ctx.lineTo(x0 + (bl ? r : 0), y1);
    if (bl) ctx.arc(x0 + r, y1 - r, r, PI / 2, PI);
    ctx.lineTo(x0, y0 + (tl ? r : 0));
    if (tl) ctx.arc(x0 + r, y0 + r, r, PI, PI * 1.5);
    ctx.closePath();
    ctx.fill();
  }

  // Fills in the inside corner of an open cell, from corner (cx, cy) with the arc centred at (ax, ay).
  function fillet(ctx, cx, cy, ax, ay, r, from, to, ccw) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(ax, ay, r, from, to, ccw);
    ctx.closePath();
    ctx.fill();
  }

  function buildWalls(T, palette, colour) {
    var canvas = document.createElement('canvas');
    canvas.width = COLS * T;
    canvas.height = ROWS * T;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = palette.mazeBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colour;

    function edge(h) { return Math.round(h * T / 2); }

    for (var hy = 0; hy < ROWS * 2; hy++) {
      for (var hx = 0; hx < COLS * 2; hx++) {
        var x0 = edge(hx), x1 = edge(hx + 1), y0 = edge(hy), y1 = edge(hy + 1);
        var r = Math.min(x1 - x0, y1 - y0);
        var left = filled(hx - 1, hy), right = filled(hx + 1, hy);
        var up = filled(hx, hy - 1), down = filled(hx, hy + 1);
        if (filled(hx, hy)) {
          solidCell(ctx, x0, y0, x1, y1, r, !left && !up, !right && !up, !right && !down, !left && !down);
          continue;
        }
        if (left && up && filled(hx - 1, hy - 1)) fillet(ctx, x0, y0, x0 + r, y0 + r, r, -PI / 2, PI, true);
        if (right && up && filled(hx + 1, hy - 1)) fillet(ctx, x1, y0, x1 - r, y0 + r, r, 0, -PI / 2, true);
        if (right && down && filled(hx + 1, hy + 1)) fillet(ctx, x1, y1, x1 - r, y1 - r, r, PI / 2, 0, true);
        if (left && down && filled(hx - 1, hy + 1)) fillet(ctx, x0, y1, x0 + r, y1 - r, r, PI, PI / 2, true);
      }
    }

    // The house counts as solid above, so the same half-tile setback gives it thin walls.
    // Now hollow it out and cut the door.
    ctx.fillStyle = palette.mazeBg;
    ctx.fillRect(11 * T, 13 * T, 6 * T, 3 * T);
    ctx.fillRect(13 * T, 12 * T, 2 * T, T);
    ctx.fillStyle = palette.door;
    var doorH = Math.max(1, Math.round(T / 4));
    ctx.fillRect(13 * T, 13 * T - Math.round(T / 2), 2 * T, doorH);
    return canvas;
  }

  var wallCache = { T: 0, normal: null, flash: null };

  function wallsFor(T, palette, flash) {
    if (wallCache.T !== T) {
      wallCache = {
        T: T,
        normal: buildWalls(T, palette, palette.wall),
        flash: buildWalls(T, palette, palette.wallFlash)
      };
    }
    return flash ? wallCache.flash : wallCache.normal;
  }

  function drawPellets(ctx, state, T, palette) {
    var size = Math.max(2, Math.round(T / 4));
    var big = T * 0.45;
    var showBig = Math.floor(state.tick / 10) % 2 === 0;
    ctx.fillStyle = palette.dot;
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        var kind = state.pellets[R.index(col, row)];
        if (!kind) continue;
        var cx = Math.round((col + 0.5) * T), cy = Math.round((row + 0.5) * T);
        if (kind === R.DOT) {
          ctx.fillRect(cx - Math.floor(size / 2), cy - Math.floor(size / 2), size, size);
        } else if (showBig) {
          ctx.beginPath();
          ctx.arc(cx, cy, big, 0, PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // ---- Actors ----

  // The position between the last two ticks. A jump this big is the tunnel wrap: no blending.
  function between(prev, cur, alpha) {
    return Math.abs(cur - prev) > 16 ? cur : prev + (cur - prev) * alpha;
  }

  function toDevice(px, T) {
    return Math.round(px * T / R.TILE);
  }

  // Draw once more on the other side when an actor overlaps the tunnel edge.
  function eachSide(x, radius, width, fn) {
    fn(x);
    if (x < radius) fn(x + width);
    if (x > width - radius) fn(x - width);
  }

  function wedge(ctx, cx, cy, r, angle, half) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle + half, angle - half + PI * 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawPac(ctx, state, alpha, T, palette) {
    var p = state.pac;
    var r = T * PAC_RADIUS;
    var x = toDevice(between(p.prevX, p.x, alpha), T);
    var y = toDevice(between(p.prevY, p.y, alpha), T);
    var angle, half;
    var animLength = G.DYING_TICKS - G.DYING_PAUSE;
    if (state.phase === 'dying' && state.phaseT <= animLength) {
      angle = DIR_ANGLE[R.UP];
      half = 0.1 + (1 - state.phaseT / animLength) * (PI - 0.1);
    } else {
      angle = DIR_ANGLE[p.dir];
      half = 0.05 + Math.abs((p.travel % MOUTH_CYCLE) / (MOUTH_CYCLE / 2) - 1) * MOUTH_WIDEST;
    }
    ctx.fillStyle = palette.pac;
    eachSide(x, r, COLS * T, function (sx) { wedge(ctx, sx, y, r, angle, half); });
  }

  function ghostBody(ctx, x, y, r, feetUp) {
    var bottom = y + r;
    var steps = 6;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r, PI, 0);
    ctx.lineTo(x + r, bottom);
    for (var i = 1; i <= steps; i++) {
      var raised = (i % 2 === 1) === feetUp;
      ctx.lineTo(x + r - i * (2 * r / steps), raised ? bottom - r * 0.32 : bottom);
    }
    ctx.closePath();
    ctx.fill();
  }

  function ghostEyes(ctx, x, y, r, dir, palette) {
    var ox = r * 0.4, oy = y - r * 0.2;
    var dx = dir === R.NONE ? 0 : R.DX[dir], dy = dir === R.NONE ? 0 : R.DY[dir];
    [-1, 1].forEach(function (side) {
      var ex = x + side * ox;
      ctx.fillStyle = palette.eye;
      ctx.beginPath();
      ctx.ellipse(ex, oy, r * 0.28, r * 0.34, 0, 0, PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.pupil;
      ctx.beginPath();
      ctx.arc(ex + dx * r * 0.13, oy + dy * r * 0.15, r * 0.16, 0, PI * 2);
      ctx.fill();
    });
  }

  function frightFace(ctx, x, y, r, colour) {
    ctx.fillStyle = colour;
    var s = Math.max(1, r * 0.2);
    ctx.fillRect(x - r * 0.42, y - r * 0.32, s, s);
    ctx.fillRect(x + r * 0.42 - s, y - r * 0.32, s, s);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    for (var i = 0; i <= 6; i++) {
      var mx = x - r * 0.6 + i * (r * 1.2 / 6);
      var my = y + r * 0.35 + (i % 2 ? -r * 0.12 : r * 0.12);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }

  function drawGhost(ctx, state, g, alpha, T, palette) {
    var r = T * GHOST_RADIUS;
    var x = toDevice(between(g.prevX, g.x, alpha), T);
    var y = toDevice(between(g.prevY, g.y, alpha), T);
    var feetUp = Math.floor(state.tick / 8) % 2 === 0;
    var look = g.loc === 'roam' || g.loc === 'eyes' ? g.nextDir : g.dir;
    var flashing = G.isFlashing(state);
    eachSide(x, r, COLS * T, function (sx) {
      if (g.loc === 'eyes' || g.loc === 'entering') {
        ghostEyes(ctx, sx, y, r, look, palette);
      } else if (g.fright) {
        ctx.fillStyle = flashing ? palette.frightFlash : palette.fright;
        ghostBody(ctx, sx, y, r, feetUp);
        frightFace(ctx, sx, y, r, flashing ? palette.frightFlashFace : palette.frightFace);
      } else {
        ctx.fillStyle = palette.ghosts[g.id];
        ghostBody(ctx, sx, y, r, feetUp);
        ghostEyes(ctx, sx, y, r, look, palette);
      }
    });
  }

  // ---- Fruit ----

  function disc(ctx, x, y, r, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, PI * 2);
    ctx.fill();
  }

  function stem(ctx, x0, y0, x1, y1, colour, width) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Each bonus item is a few flat shapes, in pixels around its centre at scale s.
  var FRUIT_ART = {
    cherry: function (ctx, s, p) {
      stem(ctx, -2.5 * s, 0, 2 * s, -5.5 * s, p.green, s);
      stem(ctx, 2.5 * s, 1 * s, 2 * s, -5.5 * s, p.green, s);
      disc(ctx, -2.8 * s, 2.5 * s, 2.8 * s, p.red);
      disc(ctx, 2.8 * s, 3.2 * s, 2.8 * s, p.red);
    },
    strawberry: function (ctx, s, p) {
      ctx.fillStyle = p.red;
      ctx.beginPath();
      ctx.moveTo(0, 6.5 * s);
      ctx.quadraticCurveTo(-7 * s, 1 * s, -4.5 * s, -3 * s);
      ctx.lineTo(4.5 * s, -3 * s);
      ctx.quadraticCurveTo(7 * s, 1 * s, 0, 6.5 * s);
      ctx.fill();
      ctx.fillStyle = p.green;
      ctx.fillRect(-4 * s, -5 * s, 8 * s, 2.5 * s);
      disc(ctx, -2 * s, 0, 0.6 * s, p.white);
      disc(ctx, 2 * s, 0.5 * s, 0.6 * s, p.white);
      disc(ctx, 0, 3 * s, 0.6 * s, p.white);
    },
    orange: function (ctx, s, p) {
      disc(ctx, 0, 1 * s, 5.5 * s, p.orange);
      stem(ctx, 0, -4 * s, 3 * s, -6 * s, p.green, 1.5 * s);
    },
    apple: function (ctx, s, p) {
      disc(ctx, -2 * s, 1.5 * s, 4 * s, p.red);
      disc(ctx, 2 * s, 1.5 * s, 4 * s, p.red);
      stem(ctx, 0, -2 * s, 2 * s, -6 * s, p.green, 1.5 * s);
    },
    melon: function (ctx, s, p) {
      disc(ctx, 0, 1 * s, 5.5 * s, p.green);
      stem(ctx, -2 * s, -3 * s, -2 * s, 5 * s, p.white, 0.8 * s);
      stem(ctx, 2 * s, -3 * s, 2 * s, 5 * s, p.white, 0.8 * s);
      stem(ctx, 0, -4 * s, 0, -6 * s, p.green, 1.2 * s);
    },
    ship: function (ctx, s, p) {
      ctx.fillStyle = p.yellow;
      ctx.beginPath();
      ctx.moveTo(0, -6 * s);
      ctx.lineTo(6 * s, 5 * s);
      ctx.lineTo(0, 2 * s);
      ctx.lineTo(-6 * s, 5 * s);
      ctx.closePath();
      ctx.fill();
      disc(ctx, 0, -1 * s, 1.5 * s, p.red);
    },
    bell: function (ctx, s, p) {
      ctx.fillStyle = p.yellow;
      ctx.beginPath();
      ctx.arc(0, -1.5 * s, 4 * s, PI, 0);
      ctx.lineTo(6 * s, 4 * s);
      ctx.lineTo(-6 * s, 4 * s);
      ctx.closePath();
      ctx.fill();
      disc(ctx, 0, 5 * s, 1.3 * s, p.orange);
    },
    key: function (ctx, s, p) {
      stem(ctx, 0, -2 * s, 0, 6 * s, p.white, 1.6 * s);
      stem(ctx, 0, 3 * s, 3 * s, 3 * s, p.white, 1.4 * s);
      stem(ctx, 0, 5.5 * s, 3 * s, 5.5 * s, p.white, 1.4 * s);
      ctx.strokeStyle = p.white;
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.arc(0, -4 * s, 2.5 * s, 0, PI * 2);
      ctx.stroke();
    }
  };

  function drawFruit(ctx, kind, cx, cy, T, palette) {
    ctx.save();
    ctx.translate(cx, cy);
    FRUIT_ART[kind](ctx, T / R.TILE, palette);
    ctx.restore();
  }

  // ---- Text ----

  function label(ctx, text, tileX, tileY, T, colour, size) {
    ctx.fillStyle = colour;
    ctx.font = 'bold ' + Math.round(T * (size || 1)) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tileX * T, tileY * T);
  }

  function messagePanel(ctx, text, T, palette) {
    var top = 13 * T;
    ctx.fillStyle = palette.panel;
    ctx.fillRect(0, top, COLS * T, 3 * T);
    label(ctx, text, COLS / 2, 14.5, T, palette.panelText);
  }

  // ---- The frame ----

  function draw(ctx, state, alpha, T, palette, message) {
    var phase = state.phase;
    var clearing = phase === 'clear';
    var clearAge = clearing ? G.CLEAR_TICKS - state.phaseT : 0;
    var flash = clearAge >= WALL_FLASH_AFTER && Math.floor(clearAge / 15) % 2 === 0;
    ctx.drawImage(wallsFor(T, palette, flash), 0, 0);

    drawPellets(ctx, state, T, palette);

    if (state.fruitT > 0 && phase !== 'over') {
      drawFruit(ctx, R.fruit(state.level).kind, toDevice(R.FRUIT_POS.x, T), toDevice(R.FRUIT_POS.y, T), T, palette);
    }

    var animating = phase === 'dying' && state.phaseT <= G.DYING_TICKS - G.DYING_PAUSE;
    var ghostsVisible = phase !== 'over' && !animating && !(clearing && clearAge >= GHOSTS_GONE_AFTER);
    if (ghostsVisible) {
      state.ghosts.forEach(function (g) {
        if (phase === 'eat' && g.id === state.eatenId) return;
        drawGhost(ctx, state, g, alpha, T, palette);
      });
    }

    if (phase !== 'over' && phase !== 'eat') drawPac(ctx, state, alpha, T, palette);

    if (state.popup) {
      label(ctx, String(state.popup.value), state.popup.x / R.TILE, state.popup.y / R.TILE, T, palette.popup, 0.85);
    }
    if (phase === 'ready') label(ctx, 'READY!', COLS / 2, 17.5, T, palette.ready);
    if (phase === 'over') label(ctx, 'GAME OVER', COLS / 2, 17.5, T, palette.over);
    if (message) messagePanel(ctx, message, T, palette);
  }

  PM.render = {
    fit: fit,
    readPalette: readPalette,
    draw: draw
  };
})();
