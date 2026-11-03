/* Pac-Man — tests. Open tests/index.html in a browser. Everything runs during page load. */
(function () {
  'use strict';

  var R = PM.rules;
  var AI = PM.ai;
  var G = PM.game;
  var UI = PM.ui;
  var UP = R.UP, LEFT = R.LEFT, DOWN = R.DOWN, RIGHT = R.RIGHT, NONE = R.NONE;
  var BLINKY = R.BLINKY, PINKY = R.PINKY, INKY = R.INKY, CLYDE = R.CLYDE;
  var results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name: name, ok: true });
    } catch (e) {
      results.push({ name: name, ok: false, error: e.message });
    }
  }

  function info(text) {
    results.push({ name: text, ok: true, info: true });
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }

  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error((msg ? msg + ': ' : '') + 'expected ' + expected + ', got ' + actual);
    }
  }

  // Seeded random numbers (mulberry32) so test runs are repeatable.
  function seeded(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Building situations ----

  function clone(state) { return JSON.parse(JSON.stringify(state)); }

  function clearPellets(s) {
    for (var i = 0; i < s.pellets.length; i++) s.pellets[i] = 0;
  }

  // A game already in play, with no pellets and every ghost waiting in the house.
  // In the first scatter they head for the corners, so a short test near the bottom is left alone.
  function arena(level, seed) {
    var s = G.create(seed || 1, level || 1);
    s.phase = 'play';
    s.phaseT = 0;
    s.startPending = false;
    clearPellets(s);
    s.ghosts.forEach(function (g) {
      g.loc = 'house';
      g.x = R.HOME_X[g.id];
      g.y = R.HOUSE_Y;
      g.dir = UP;
    });
    return s;
  }

  function put(a, x, y, dir) {
    a.x = x;
    a.y = y;
    a.prevX = x;
    a.prevY = y;
    a.dir = dir;
    if (a.nextDir !== undefined) {
      a.nextDir = dir;
      a.arrive = dir;
      a.loc = 'roam';
    } else {
      a.want = dir;
    }
  }

  function run(s, ticks) {
    for (var i = 0; i < ticks; i++) G.tick(s);
  }

  function tileX(col) { return R.centre(col); }
  function tileY(row) { return R.centre(row); }

  // ---- The maze ----

  test('the maze is 28 by 31 and mirror-symmetric', function () {
    eq(R.MAZE.length, 31);
    R.MAZE.forEach(function (line, i) {
      eq(line.length, 28, 'row ' + i);
      eq(line, line.split('').reverse().join(''), 'row ' + i);
    });
  });

  test('there are 240 dots and 4 energizers, all reachable', function () {
    var dots = 0, big = 0;
    var pellets = R.createPellets();
    for (var row = 0; row < R.ROWS; row++) {
      for (var col = 0; col < R.COLS; col++) {
        var p = pellets[R.index(col, row)];
        if (p === R.DOT) dots++;
        if (p === R.ENERGIZER) big++;
        if (p) assert(R.isOpen(col, row), 'pellet on a closed tile at ' + col + ',' + row);
      }
    }
    eq(dots, 240, 'dots');
    eq(big, 4, 'energizers');
  });

  test('the corridors have no dead ends', function () {
    for (var row = 0; row < R.ROWS; row++) {
      for (var col = 0; col < R.COLS; col++) {
        if (!R.isOpen(col, row)) continue;
        var exits = 0;
        for (var d = 0; d < 4; d++) if (R.isOpen(col + R.DX[d], row + R.DY[d])) exits++;
        assert(exits >= 2, 'dead end at ' + col + ',' + row);
      }
    }
  });

  test('the house and the door are closed to the corridors', function () {
    assert(!R.isOpen(13, 12), 'door');
    assert(!R.isOpen(14, 12), 'door');
    for (var row = 13; row <= 15; row++) {
      for (var col = 11; col <= 16; col++) assert(!R.isOpen(col, row), 'house at ' + col + ',' + row);
    }
  });

  test('the side blocks are closed and the tunnel wraps', function () {
    assert(!R.isOpen(0, 11), 'left block');
    assert(!R.isOpen(27, 17), 'right block');
    assert(R.isOpen(-1, 14), 'wrap left');
    assert(R.isOpen(28, 14), 'wrap right');
    assert(R.isTunnel(0, 14) && R.isTunnel(5, 14) && R.isTunnel(22, 14) && R.isTunnel(27, 14), 'tunnel');
    assert(!R.isTunnel(6, 14) && !R.isTunnel(21, 14) && !R.isTunnel(0, 13), 'not tunnel');
  });

  test('starting spots are where they should be', function () {
    eq(R.tileOf(R.PAC_START.y), 23);
    assert(R.isOpen(R.tileOf(R.PAC_START.x), R.tileOf(R.PAC_START.y)), 'pac');
    assert(R.isOpen(R.tileOf(R.FRUIT_POS.x), R.tileOf(R.FRUIT_POS.y)), 'fruit');
    assert(R.isOpen(R.DOOR_TILE.col, R.DOOR_TILE.row), 'above the door');
    eq(R.centre(R.DOOR_TILE.row), R.DOOR_Y);
  });

  // ---- Level tables ----

  test('speeds, fright and fruit follow the level tables', function () {
    eq(R.speeds(1).pac, 80);
    eq(R.speeds(1).ghost, 75);
    eq(R.speeds(4).pac, 90);
    eq(R.speeds(5).pac, 100);
    eq(R.speeds(20).pac, 100);
    eq(R.speeds(21).pac, 90);
    eq(R.speeds(99).ghost, 95);
    eq(R.frightTicks(1), 360);
    eq(R.frightTicks(9), 60);
    eq(R.frightTicks(17), 0);
    eq(R.frightTicks(18), 60);
    eq(R.frightTicks(19), 0);
    eq(R.frightTicks(50), 0);
    eq(R.flashCount(1), 5);
    eq(R.flashCount(9), 3);
    eq(R.fruit(1).points, 100);
    eq(R.fruit(4).points, 500);
    eq(R.fruit(12).points, 3000);
    eq(R.fruit(40).points, 5000);
    eq(R.elroy(1).dots1, 20);
    eq(R.elroy(4).speed1, 90);
    eq(R.elroy(5).speed1, 100);
    eq(R.elroy(30).dots2, 60);
  });

  test('the scatter and chase schedules end in chase for good', function () {
    [1, 2, 5, 40].forEach(function (level) {
      var sch = R.schedule(level);
      eq(sch.length, 8);
      eq(sch[7], -1);
    });
    eq(R.schedule(1)[0], 7 * 60);
    eq(R.schedule(1)[1], 20 * 60);
    eq(R.schedule(4)[5], 1033 * 60);
    eq(R.schedule(4)[6], 1);
    eq(R.schedule(5)[0], 5 * 60);
    eq(R.schedule(5)[5], 1037 * 60);
  });

  // ---- Ghost targets ----

  function chaseState() {
    var s = arena(1);
    s.modeI = 1;
    s.modeT = 1000;
    return s;
  }

  test('in scatter each ghost heads for its own corner', function () {
    var s = arena(1);
    eq(s.modeI, 0);
    [BLINKY, PINKY, INKY, CLYDE].forEach(function (id) {
      var t = AI.target(s, s.ghosts[id]);
      eq(t.col, R.SCATTER[id].col);
      eq(t.row, R.SCATTER[id].row);
    });
    eq(R.SCATTER[BLINKY].row, -3, 'the corners are outside the grid');
  });

  test('Blinky chases Pac-Man himself', function () {
    var s = chaseState();
    put(s.pac, tileX(6), tileY(5), RIGHT);
    var t = AI.target(s, s.ghosts[BLINKY]);
    eq(t.col, 6);
    eq(t.row, 5);
  });

  test('Pinky aims 4 tiles ahead, with the arcade bug when facing up', function () {
    var s = chaseState();
    put(s.pac, tileX(10), tileY(20), RIGHT);
    var t = AI.target(s, s.ghosts[PINKY]);
    eq(t.col, 14);
    eq(t.row, 20);
    put(s.pac, tileX(10), tileY(20), UP);
    t = AI.target(s, s.ghosts[PINKY]);
    eq(t.col, 6, 'up also goes left');
    eq(t.row, 16);
    put(s.pac, tileX(1), tileY(29), LEFT);
    t = AI.target(s, s.ghosts[PINKY]);
    eq(t.col, -3, 'off the map is allowed');
  });

  test('Inky doubles the line from Blinky through the spot 2 ahead of Pac-Man', function () {
    var s = chaseState();
    put(s.pac, tileX(10), tileY(20), RIGHT);
    put(s.ghosts[BLINKY], tileX(10), tileY(26), LEFT);
    var t = AI.target(s, s.ghosts[INKY]);
    eq(t.col, 2 * 12 - 10);
    eq(t.row, 2 * 20 - 26);
  });

  test('Clyde chases from afar and runs for his corner inside 8 tiles', function () {
    var s = chaseState();
    put(s.pac, tileX(1), tileY(1), RIGHT);
    put(s.ghosts[CLYDE], tileX(1), tileY(9), UP);
    s.ghosts[CLYDE].y = tileY(9);
    var t = AI.target(s, s.ghosts[CLYDE]);
    eq(t.col, 1, 'exactly 8 tiles away still chases');
    eq(t.row, 1);
    s.ghosts[CLYDE].y = tileY(8);
    t = AI.target(s, s.ghosts[CLYDE]);
    eq(t.col, R.SCATTER[CLYDE].col, 'inside 8 tiles');
    eq(t.row, R.SCATTER[CLYDE].row);
  });

  test('Blinky ignores scatter once sped up, except just after a death', function () {
    var s = arena(1);
    put(s.pac, tileX(6), tileY(5), RIGHT);
    s.dotsLeft = 20;
    eq(AI.elroyStage(s), 1);
    eq(AI.target(s, s.ghosts[BLINKY]).col, 6);
    s.dotsLeft = 10;
    eq(AI.elroyStage(s), 2);
    s.elroyHold = true;
    eq(AI.elroyStage(s), 0);
    eq(AI.target(s, s.ghosts[BLINKY]).col, R.SCATTER[BLINKY].col);
  });

  // ---- Ghost choices ----

  test('ties break in the order up, left, down, right', function () {
    var s = chaseState();
    var g = s.ghosts[BLINKY];
    g.loc = 'roam';
    put(s.pac, tileX(6), tileY(5), RIGHT);
    eq(AI.chooseDir(s, g, 6, 5, RIGHT), UP, 'up beats right and down');
    put(s.pac, tileX(9), tileY(23), RIGHT);
    eq(AI.chooseDir(s, g, 9, 23, LEFT), LEFT, 'left beats down');
    eq(AI.chooseDir(s, g, 9, 23, RIGHT), DOWN, 'down beats right');
  });

  test('a roaming ghost never chooses to turn back, on any tile', function () {
    var s = chaseState();
    var g = s.ghosts[BLINKY];
    g.loc = 'roam';
    put(s.pac, tileX(14), tileY(29), LEFT);
    for (var row = 0; row < R.ROWS; row++) {
      for (var col = 0; col < R.COLS; col++) {
        if (!R.isOpen(col, row)) continue;
        for (var heading = 0; heading < 4; heading++) {
          // Only headings it could arrive with.
          if (!R.isOpen(col - R.DX[heading], row - R.DY[heading])) continue;
          [false, true].forEach(function (blue) {
            g.fright = blue;
            var d = AI.chooseDir(s, g, col, row, heading);
            assert(d !== R.opposite(heading), 'turned back at ' + col + ',' + row);
            assert(R.isOpen(col + R.DX[d], row + R.DY[d]), 'into a wall at ' + col + ',' + row);
          });
        }
      }
    }
  });

  test('no going up at the four marked tiles, except when frightened', function () {
    var s = chaseState();
    var g = s.ghosts[BLINKY];
    g.loc = 'roam';
    [[12, 11, LEFT], [15, 11, RIGHT], [12, 23, LEFT], [15, 23, RIGHT]].forEach(function (c) {
      put(s.pac, tileX(c[0]), tileY(c[1] - 1), UP); // straight above, so up would be best
      assert(R.isOpen(c[0], c[1] - 1), 'there is a way up');
      assert(AI.chooseDir(s, g, c[0], c[1], c[2]) !== UP, 'went up at ' + c[0] + ',' + c[1]);
    });
    g.fright = true;
    var wentUp = false;
    for (var i = 0; i < 50; i++) {
      if (AI.chooseDir(s, g, 12, 11, LEFT) === UP) wentUp = true;
    }
    assert(wentUp, 'a frightened ghost may go up');
  });

  test('a frightened ghost picks its turns from the game seed', function () {
    var a = chaseState(), b = chaseState();
    a.ghosts[BLINKY].fright = true;
    b.ghosts[BLINKY].fright = true;
    for (var i = 0; i < 20; i++) {
      eq(AI.chooseDir(a, a.ghosts[BLINKY], 6, 5, RIGHT), AI.chooseDir(b, b.ghosts[BLINKY], 6, 5, RIGHT));
    }
  });

  // ---- Mode changes and reversals ----

  test('switching between scatter and chase makes ghosts turn back', function () {
    var s = arena(1);
    var g = s.ghosts[BLINKY];
    put(g, tileX(5), tileY(29), LEFT);
    g.x = tileX(5) + 2; // between two tile centres
    put(s.pac, tileX(20), tileY(29), RIGHT);
    s.modeT = 1;
    G.tick(s);
    eq(s.modeI, 1);
    eq(s.modeT, 1200);
    eq(g.dir, RIGHT);
  });

  test('turning back on a tile centre goes the way it came, not into a wall', function () {
    var s = chaseState();
    var g = s.ghosts[BLINKY];
    // It came along row 26 heading left and has just turned up at column 6. Below is a wall.
    g.loc = 'roam';
    g.x = tileX(6);
    g.y = tileY(26);
    g.arrive = LEFT;
    g.dir = UP;
    g.nextDir = UP;
    assert(!R.isOpen(6, 27), 'below is a wall');
    AI.reverse(s, g);
    eq(g.dir, RIGHT);
  });

  test('the scatter and chase clock stands still during fright', function () {
    var s = arena(1);
    put(s.pac, tileX(20), tileY(29), RIGHT);
    s.modeT = 100;
    s.frightT = 5;
    run(s, 5);
    eq(s.modeT, 100);
    eq(s.frightT, 0);
    G.tick(s);
    eq(s.modeT, 99);
  });

  test('fright ending does not make ghosts turn back', function () {
    var s = arena(1);
    var g = s.ghosts[BLINKY];
    put(g, tileX(5), tileY(29), LEFT);
    g.fright = true;
    put(s.pac, tileX(20), tileY(29), RIGHT);
    s.frightT = 1;
    G.tick(s);
    eq(g.fright, false);
    eq(g.dir, LEFT);
  });

  test('an energizer turns ghosts blue and back, also where fright lasts no time at all', function () {
    [1, 17].forEach(function (level) {
      var s = arena(level);
      var g = s.ghosts[BLINKY];
      put(g, tileX(5) + 2, tileY(29), LEFT);
      put(s.pac, tileX(1), 32, UP);
      s.pellets[R.index(1, 3)] = R.ENERGIZER;
      G.tick(s);
      eq(g.dir, RIGHT, 'level ' + level);
      eq(g.fright, level === 1, 'level ' + level);
      eq(s.frightT > 0, level === 1, 'level ' + level);
    });
  });

  // ---- Movement ----

  test('distance per tick is exact at every speed', function () {
    [[1, 100], [2, 112], [5, 125], [21, 112]].forEach(function (c) {
      var s = arena(c[0]);
      put(s.pac, tileX(1), tileY(29), RIGHT);
      run(s, 100);
      eq(s.pac.x - tileX(1), c[1], 'level ' + c[0]);
    });
  });

  test('a ghost covers exact distances too', function () {
    var s = arena(1);
    var g = s.ghosts[BLINKY];
    put(s.pac, tileX(1), tileY(29), LEFT);
    put(g, tileX(26), tileY(29), LEFT);
    run(s, 80);
    eq(tileX(26) - g.x, 75);
  });

  test('dots slow Pac-Man by one tick each', function () {
    var s = arena(1);
    for (var col = 3; col <= 11; col++) s.pellets[R.index(col, 29)] = R.DOT;
    put(s.pac, tileX(2), tileY(29), RIGHT);
    run(s, 72);
    eq(s.pac.x - tileX(2), 64, 'eight tiles in 72 ticks');
    eq(s.score, 80);
  });

  test('an energizer slows Pac-Man by three ticks', function () {
    var s = arena(1);
    s.pellets[R.index(3, 29)] = R.ENERGIZER;
    put(s.pac, tileX(2), tileY(29), RIGHT);
    run(s, 4);
    eq(s.pac.x, tileX(3) - 4);
    eq(s.score, 50);
    run(s, 3);
    eq(s.pac.x, tileX(3) - 4, 'still eating');
    run(s, 2);
    assert(s.pac.x > tileX(3) - 4, 'moving again');
  });

  test('Pac-Man stops at a wall, exactly on the tile centre', function () {
    var s = arena(1);
    put(s.pac, tileX(4), tileY(29), LEFT);
    run(s, 60);
    eq(s.pac.x, tileX(1));
    eq(s.pac.y, tileY(29));
  });

  test('he can turn at every pixel of the tile with the side corridor', function () {
    // Column 12 opens upward from row 29. Tile 12 covers x = 96 to 103.
    for (var x = 96; x <= 103; x++) {
      [RIGHT, LEFT].forEach(function (dir) {
        var s = arena(1);
        put(s.pac, x, tileY(29), dir);
        s.pac.want = UP;
        G.tick(s);
        eq(s.pac.dir, UP, 'x=' + x + ' heading ' + dir);
        run(s, 12);
        eq(s.pac.x, tileX(12), 'x=' + x + ' ends on the corridor centre');
        assert(s.pac.y < tileY(29) - 8, 'x=' + x + ' went up');
      });
    }
  });

  test('a key pressed early waits for the corner, however far off', function () {
    for (var x = 20; x < 96; x++) {
      var s = arena(1);
      put(s.pac, x, tileY(29), RIGHT);
      G.tick(s, UP);
      eq(s.pac.dir, RIGHT, 'keeps going at x=' + x);
      run(s, 100 - x + 12);
      eq(s.pac.x, tileX(12), 'turned at the corner from x=' + x);
      assert(s.pac.y < tileY(29), 'went up from x=' + x);
    }
  });

  test('a turn into a wall neither stops him nor gets lost', function () {
    var s = arena(1);
    put(s.pac, tileX(5), tileY(29), RIGHT);
    G.tick(s, DOWN);
    run(s, 10);
    eq(s.pac.x, tileX(5) + 11, 'carries on');
    eq(s.pac.dir, RIGHT);
    eq(s.pac.want, DOWN, 'still waiting');
  });

  test('reversing is instant, anywhere', function () {
    for (var x = 40; x <= 48; x++) {
      var s = arena(1);
      put(s.pac, x, tileY(29), RIGHT);
      G.tick(s, LEFT);
      eq(s.pac.dir, LEFT);
      eq(s.pac.x, x - 1);
    }
  });

  test('Pac-Man and ghosts go through the tunnel in both directions', function () {
    var s = arena(1);
    put(s.pac, 3, tileY(14), LEFT);
    run(s, 8);
    eq(s.pac.x, 219);
    eq(s.pac.y, tileY(14));
    put(s.pac, 220, tileY(14), RIGHT);
    run(s, 8);
    eq(s.pac.x, 4);

    var t = arena(1);
    var g = t.ghosts[BLINKY];
    put(t.pac, tileX(1), tileY(29), LEFT);
    put(g, tileX(2), tileY(14), LEFT);
    run(t, 60); // half a pixel per tick in the tunnel
    assert(g.x > 200, 'wrapped to the right side, at ' + g.x);
    eq(g.y, tileY(14));
  });

  test('ghosts slow down in the tunnel', function () {
    var s = arena(1);
    var g = s.ghosts[BLINKY];
    put(s.pac, tileX(1), tileY(29), LEFT);
    put(g, tileX(5), tileY(14), LEFT);
    eq(AI.ghostSpeed(s, g), 40);
    g.fright = true;
    eq(AI.ghostSpeed(s, g), 40, 'even when blue');
    put(g, tileX(9), tileY(14), LEFT);
    g.fright = true;
    eq(AI.ghostSpeed(s, g), 50);
    g.fright = false;
    eq(AI.ghostSpeed(s, g), 75);
    s.dotsLeft = 20;
    eq(AI.ghostSpeed(s, g), 80, 'Blinky sped up');
    eq(AI.ghostSpeed(s, s.ghosts[PINKY]), 40, 'still in the house');
  });

  // ---- Collisions ----

  test('head-on meetings never pass through, at any speed, offset or phase', function () {
    var runs = 0;
    [1, 2, 5, 21].forEach(function (level) {
      for (var pacAcc = 0; pacAcc < 80; pacAcc += 13) {
        for (var ghostAcc = 0; ghostAcc < 80; ghostAcc += 13) {
          for (var gap = 12; gap <= 44; gap++) {
            var s = arena(level);
            s.modeI = 1;
            s.modeT = 1000;
            var g = s.ghosts[BLINKY];
            put(s.pac, 24, tileY(29), RIGHT);
            s.pac.acc = pacAcc;
            put(g, 24 + gap, tileY(29), LEFT);
            g.acc = ghostAcc;
            for (var t = 0; t < 60 && s.phase === 'play'; t++) {
              G.tick(s);
              assert(g.x >= s.pac.x || s.phase === 'dying', 'passed through at gap ' + gap + ', level ' + level);
            }
            eq(s.phase, 'dying', 'gap ' + gap + ', level ' + level);
            runs++;
          }
        }
      }
    });
    info('head-on meetings tried: ' + runs);
  });

  test('head-on meetings across the tunnel seam never pass through either', function () {
    [1, 2, 5, 21].forEach(function (level) {
      for (var pacAcc = 0; pacAcc < 80; pacAcc += 13) {
        for (var ghostAcc = 0; ghostAcc < 80; ghostAcc += 13) {
          for (var gap = 12; gap <= 30; gap++) {
            var s = arena(level);
            s.modeI = 1;
            s.modeT = 1000;
            var g = s.ghosts[BLINKY];
            put(s.pac, 10, tileY(14), LEFT);
            s.pac.acc = pacAcc;
            put(g, R.wrapX(10 - gap), tileY(14), RIGHT);
            g.acc = ghostAcc;
            for (var t = 0; t < 80 && s.phase === 'play'; t++) G.tick(s);
            eq(s.phase, 'dying', 'gap ' + gap + ', level ' + level);
          }
        }
      }
    });
  });

  test('touching across the seam counts, and a corridor away does not', function () {
    assert(G.touching({ x: 1, y: 116 }, 222, 116), 'across the seam');
    assert(G.touching({ x: 222, y: 116 }, 1, 116), 'and back');
    assert(!G.touching({ x: 10, y: 116 }, 200, 116), 'far apart');
    assert(G.touching({ x: 100, y: 100 }, 104, 104), 'at the limit');
    assert(!G.touching({ x: 100, y: 100 }, 105, 100), 'just over');
  });

  test('a standing Pac-Man still gets caught', function () {
    var s = arena(1);
    s.modeI = 1;
    s.modeT = 1000;
    put(s.pac, tileX(1), tileY(29), LEFT); // up against the wall
    put(s.ghosts[BLINKY], tileX(8), tileY(29), LEFT);
    run(s, 80);
    eq(s.phase, 'dying');
  });

  test('an energizer beats a touch on the same tick', function () {
    var s = arena(1);
    s.pellets[R.index(1, 3)] = R.ENERGIZER;
    put(s.pac, tileX(1), 32, UP);
    put(s.ghosts[BLINKY], tileX(1), 28, DOWN);
    G.tick(s);
    eq(s.phase, 'eat');
    eq(s.lives, 3);
    eq(s.score, 250);
  });

  test('the last dot beats a touch on the same tick', function () {
    var s = arena(1);
    s.dotsLeft = 1;
    s.pellets[R.index(4, 29)] = R.DOT;
    put(s.pac, tileX(4) - 5, tileY(29), RIGHT);
    put(s.ghosts[BLINKY], tileX(4) - 2, tileY(29), LEFT);
    G.tick(s);
    eq(s.phase, 'clear');
    eq(s.lives, 3);
  });

  test('stacked blue ghosts are eaten one at a time', function () {
    var s = arena(1);
    put(s.pac, tileX(5), tileY(29), LEFT);
    s.frightT = 300;
    [BLINKY, PINKY].forEach(function (id) {
      put(s.ghosts[id], tileX(5), tileY(29), LEFT);
      s.ghosts[id].fright = true;
    });
    G.tick(s);
    eq(s.phase, 'eat');
    eq(s.score, 200);
    eq(s.ghosts[BLINKY].loc, 'eyes');
    eq(s.ghosts[PINKY].loc, 'roam');
    run(s, 60);
    eq(s.phase, 'eat', 'the second one, once the freeze ends');
    eq(s.score, 600);
    eq(s.ghosts[PINKY].loc, 'eyes');
  });

  test('ghost points double for each ghost on one energizer, then start over', function () {
    var s = arena(1);
    s.pellets[R.index(4, 29)] = R.ENERGIZER;
    put(s.pac, tileX(1), tileY(29), LEFT);
    s.frightT = 900;
    var scores = [];
    [BLINKY, PINKY, INKY, CLYDE].forEach(function (id) {
      put(s.ghosts[id], s.pac.x, s.pac.y, LEFT);
      s.ghosts[id].fright = true;
      var before = s.score;
      G.tick(s);
      scores.push(s.score - before);
      run(s, 60);
    });
    eq(scores.join(), '200,400,800,1600');
    put(s.pac, tileX(4) - 5, tileY(29), RIGHT);
    run(s, 2);
    eq(s.combo, 0, 'the next energizer starts over');
  });

  test('during the freeze only eyes eaten earlier keep moving', function () {
    var s = arena(1);
    put(s.pac, tileX(20), tileY(29), LEFT);
    var earlier = s.ghosts[BLINKY];
    put(earlier, tileX(5), tileY(5), RIGHT);
    earlier.loc = 'eyes';
    var justEaten = s.ghosts[PINKY];
    put(justEaten, tileX(20), tileY(29), LEFT);
    justEaten.fright = true;
    s.frightT = 300;
    G.tick(s);
    eq(s.phase, 'eat');
    var eyesX = earlier.x, eatenX = justEaten.x, pacX = s.pac.x, inkyY = s.ghosts[INKY].y;
    run(s, 5);
    assert(earlier.x !== eyesX, 'earlier eyes move');
    eq(justEaten.x, eatenX, 'the ghost just eaten waits');
    eq(s.pac.x, pacX, 'Pac-Man waits');
    eq(s.ghosts[INKY].y, inkyY, 'others wait');
    eq(s.frightT, 300 - 1, 'the fright clock waits');
  });

  test('a revived ghost is dangerous among blue ones', function () {
    var s = arena(1);
    put(s.pac, tileX(1), tileY(29), LEFT);
    s.frightT = 900;
    var g = s.ghosts[BLINKY];
    put(g, R.DOOR_X, R.DOOR_Y, LEFT);
    g.loc = 'entering';
    s.ghosts[PINKY].fright = true;
    var cap = 500;
    while (g.loc !== 'roam' && cap-- > 0) G.tick(s);
    eq(g.loc, 'roam');
    eq(g.fright, false);
    assert(s.frightT > 0, 'fright is still on');
    eq(s.ghosts[PINKY].fright, true);
    put(s.pac, tileX(20), tileY(29), LEFT);
    put(g, tileX(20), tileY(29), LEFT);
    G.tick(s);
    eq(s.phase, 'dying');
  });

  // ---- The house ----

  test('level 1 lets Pinky out at once, Inky after 30 dots and Clyde after 60 more', function () {
    var s = G.create(1, 1);
    AI.updateHouse(s);
    eq(s.ghosts[PINKY].loc, 'leaving');
    var i;
    for (i = 0; i < 29; i++) { AI.onPelletEaten(s); AI.updateHouse(s); }
    eq(s.ghosts[INKY].loc, 'house', 'after 29');
    eq(s.ghosts[CLYDE].dotCount, 0, 'only the first in line counts');
    AI.onPelletEaten(s);
    AI.updateHouse(s);
    eq(s.ghosts[INKY].loc, 'leaving', 'after 30');
    for (i = 0; i < 59; i++) { AI.onPelletEaten(s); AI.updateHouse(s); }
    eq(s.ghosts[CLYDE].loc, 'house', 'after 59');
    AI.onPelletEaten(s);
    AI.updateHouse(s);
    eq(s.ghosts[CLYDE].loc, 'leaving', 'after 60');
  });

  test('levels 2 and 3 lower the dot limits', function () {
    eq(R.dotLimit(2, INKY), 0);
    eq(R.dotLimit(2, CLYDE), 50);
    eq(R.dotLimit(3, CLYDE), 0);
    eq(R.dotLimit(30, CLYDE), 0);
  });

  test('a long wait without eating forces the next ghost out', function () {
    [[1, 240], [5, 180]].forEach(function (c) {
      var s = G.create(1, c[0]);
      s.ghosts[PINKY].loc = 'roam';
      s.ghosts[INKY].dotCount = -1000; // so only the timer can free it
      var i;
      for (i = 0; i < c[1] - 1; i++) AI.updateHouse(s);
      eq(s.ghosts[INKY].loc, 'house', 'just before, level ' + c[0]);
      AI.updateHouse(s);
      eq(s.ghosts[INKY].loc, 'leaving', 'level ' + c[0]);
      eq(s.noDotT, 0);
    });
  });

  test('after a death the global counter frees them at 7, 17 and 32', function () {
    var s = G.create(1, 1);
    s.useGlobal = true;
    s.globalDots = 0;
    s.elroyHold = true;
    function eat(n) { for (var i = 0; i < n; i++) { AI.onPelletEaten(s); AI.updateHouse(s); } }
    eat(6);
    eq(s.ghosts[PINKY].loc, 'house');
    eat(1);
    eq(s.ghosts[PINKY].loc, 'leaving');
    eat(9);
    eq(s.ghosts[INKY].loc, 'house');
    eat(1);
    eq(s.ghosts[INKY].loc, 'leaving');
    eat(14);
    eq(s.ghosts[CLYDE].loc, 'house');
    eq(s.elroyHold, true);
    eat(1);
    eq(s.ghosts[CLYDE].loc, 'leaving');
    eq(s.useGlobal, false, 'back to the personal counters');
    eq(s.elroyHold, false, 'Blinky may speed up again');
  });

  test('every ghost follows the rail out of the house and turns left', function () {
    [PINKY, INKY, CLYDE].forEach(function (id) {
      var s = arena(1);
      put(s.pac, tileX(1), tileY(29), LEFT);
      var g = s.ghosts[id];
      g.loc = 'leaving';
      var cap = 400;
      while (g.loc !== 'roam' && cap-- > 0) {
        if (id !== PINKY && g.x !== R.DOOR_X) assert(g.y >= R.BOB_MIN_Y, 'stays in the house until the door column');
        G.tick(s);
      }
      eq(g.loc, 'roam', 'ghost ' + id);
      eq(g.y, R.DOOR_Y);
      eq(g.x, R.DOOR_X, 'ghost ' + id);
      eq(g.dir, LEFT, 'ghost ' + id);
    });
  });

  test('a reversal while inside makes the ghost come out to the right', function () {
    var s = arena(1);
    put(s.pac, tileX(1), tileY(29), LEFT);
    var g = s.ghosts[PINKY];
    AI.reverse(s, g);
    g.loc = 'leaving';
    var cap = 400;
    while (g.loc !== 'roam' && cap-- > 0) G.tick(s);
    eq(g.dir, RIGHT);
  });

  test('eyes find the door from anywhere and revive in the right place', function () {
    var starts = [[1, 1], [26, 1], [1, 29], [26, 29], [6, 14], [21, 14], [13, 11], [14, 11], [13, 23]];
    starts.forEach(function (c) {
      for (var heading = 0; heading < 4; heading++) {
        if (!R.isOpen(c[0] + R.DX[heading], c[1] + R.DY[heading])) continue;
        var s = arena(1);
        put(s.pac, tileX(1), tileY(5), LEFT);
        var g = s.ghosts[BLINKY];
        put(g, tileX(c[0]), tileY(c[1]), heading);
        g.loc = 'eyes';
        AI.aim(s, g);
        var cap = 2000;
        var sawHome = false;
        while (g.loc !== 'leaving' && cap-- > 0) {
          AI.moveGhost(s, g);
          if (g.loc === 'entering') sawHome = true;
        }
        assert(sawHome, 'never reached the door from ' + c);
        eq(g.loc, 'leaving', 'from ' + c);
        eq(g.x, R.HOME_X[BLINKY]);
        assert(Math.abs(g.y - R.HOUSE_Y) <= 1, 'in the middle of the house, at y=' + g.y);
      }
    });
  });

  test('a ghost eaten just outside the door goes straight in', function () {
    var s = arena(1);
    var g = s.ghosts[BLINKY];
    put(g, R.DOOR_X, R.DOOR_Y, LEFT);
    AI.sendHome(s, g);
    eq(g.loc, 'entering');
    eq(g.dir, DOWN);
  });

  test('a ghost caught at the door turns straight back on the rail', function () {
    var s = arena(1);
    var g = s.ghosts[PINKY];
    g.loc = 'leaving';
    g.x = R.DOOR_X;
    g.y = R.DOOR_Y + 3;
    g.fright = true;
    s.frightT = 300;
    put(s.pac, R.DOOR_X, R.DOOR_Y, LEFT);
    G.tick(s);
    eq(s.phase, 'eat');
    eq(g.loc, 'entering');
    run(s, 80);
    assert(g.loc === 'leaving' || g.loc === 'roam', 'it got home, now ' + g.loc);
  });

  // ---- Score, fruit, lives, levels ----

  test('fruit appears after 70 and 170 dots and goes away again', function () {
    var s = arena(1);
    s.dotsEaten = 69;
    s.pellets[R.index(4, 29)] = R.DOT;
    put(s.pac, tileX(4) - 5, tileY(29), RIGHT);
    G.tick(s);
    eq(s.dotsEaten, 70);
    assert(s.fruitT > 560, 'fruit is out');
    var t = arena(1);
    t.fruitT = 2;
    put(t.pac, tileX(1), tileY(29), LEFT);
    run(t, 2);
    eq(t.fruitT, 0);
    eq(t.score, 0);
    var u = arena(1);
    u.dotsEaten = 169;
    u.pellets[R.index(4, 29)] = R.DOT;
    put(u.pac, tileX(4) - 5, tileY(29), RIGHT);
    G.tick(u);
    assert(u.fruitT > 560, 'fruit is out again');
  });

  test('eating the fruit scores what the level says', function () {
    [[1, 100], [2, 300], [13, 5000]].forEach(function (c) {
      var s = arena(c[0]);
      s.fruitT = 100;
      put(s.pac, R.FRUIT_POS.x - 8, R.FRUIT_POS.y, RIGHT);
      run(s, 8);
      eq(s.score, c[1], 'level ' + c[0]);
      eq(s.fruitT, 0);
    });
  });

  test('one extra life at 10,000 points, and only one', function () {
    var s = arena(1);
    s.score = 9990;
    s.pellets[R.index(4, 29)] = R.DOT;
    s.pellets[R.index(5, 29)] = R.DOT;
    put(s.pac, tileX(4) - 5, tileY(29), RIGHT);
    run(s, 12);
    eq(s.score, 10010);
    eq(s.lives, 4);
    eq(s.extraLife, true);
  });

  test('losing a life resets the actors but keeps the dots and the score', function () {
    var s = G.create(1, 1);
    s.phase = 'play';
    s.startPending = false;
    s.pellets[R.index(1, 1)] = 0;
    s.dotsLeft = 243;
    s.score = 500;
    s.ghosts[INKY].dotCount = 12;
    s.modeI = 3;
    put(s.ghosts[BLINKY], s.pac.x, s.pac.y, LEFT);
    G.tick(s);
    eq(s.phase, 'dying');
    run(s, G.DYING_TICKS);
    eq(s.phase, 'ready');
    eq(s.lives, 2);
    eq(s.score, 500);
    eq(s.dotsLeft, 243);
    eq(s.pac.x, R.PAC_START.x);
    eq(s.ghosts[BLINKY].y, R.DOOR_Y);
    eq(s.ghosts[INKY].dotCount, 12, 'personal counters are kept');
    eq(s.modeI, 0, 'the clock restarts');
    eq(s.useGlobal, true);
    eq(s.elroyHold, true);
  });

  test('the last life ends the game, and nothing moves after that', function () {
    var s = G.create(1, 1);
    s.phase = 'play';
    s.startPending = false;
    s.lives = 1;
    put(s.ghosts[BLINKY], s.pac.x, s.pac.y, LEFT);
    run(s, 1 + G.DYING_TICKS);
    eq(s.phase, 'over');
    eq(s.lives, 0);
    var x = s.pac.x, score = s.score;
    run(s, 100);
    eq(s.phase, 'over');
    eq(s.pac.x, x);
    eq(s.score, score);
  });

  test('clearing the maze starts the next level with fresh dots and counters', function () {
    var s = G.create(1, 1);
    s.phase = 'play';
    s.startPending = false;
    clearPellets(s);
    s.dotsLeft = 1;
    s.pellets[R.index(10, 23)] = R.DOT;
    s.score = 100;
    s.ghosts[CLYDE].dotCount = 40;
    s.useGlobal = true;
    put(s.pac, tileX(10) + 5, tileY(23), LEFT);
    run(s, 2);
    eq(s.phase, 'clear');
    run(s, G.CLEAR_TICKS);
    eq(s.phase, 'ready');
    eq(s.level, 2);
    eq(s.dotsLeft, 244);
    eq(s.lives, 3);
    eq(s.score, 110);
    eq(s.ghosts[CLYDE].dotCount, 0);
    eq(s.useGlobal, false);
  });

  // ---- Whole games, without any page ----

  test('an idle Pac-Man loses all his lives: the ghosts hunt and leave the house', function () {
    [1, 2, 3].forEach(function (seed) {
      var s = G.create(seed);
      var cap = 60 * 600;
      var seen = {};
      while (s.phase !== 'over' && cap-- > 0) {
        G.tick(s);
        s.ghosts.forEach(function (g) { if (g.loc === 'roam') seen[g.id] = true; });
      }
      eq(s.phase, 'over', 'seed ' + seed);
      assert(seen[PINKY] && seen[BLINKY], 'seed ' + seed + ': Blinky and Pinky roamed');
    });
  });

  // Throws if a state breaks a rule that must hold on every tick.
  function checkInvariants(s, before) {
    var p = s.pac;
    assert(R.isOpen(R.tileOf(p.x), R.tileOf(p.y)), 'Pac-Man in a wall at ' + p.x + ',' + p.y);
    assert(p.x >= 0 && p.x < R.WIDTH, 'Pac-Man off the map');
    assert(s.score >= before.score, 'the score dropped');
    s.ghosts.forEach(function (g) {
      if (g.loc === 'roam' || g.loc === 'eyes') {
        assert(R.isOpen(R.tileOf(g.x), R.tileOf(g.y)), 'ghost ' + g.id + ' in a wall at ' + g.x + ',' + g.y + ' (' + g.loc + ')');
        assert(g.x % 8 === 4 || g.y % 8 === 4, 'ghost ' + g.id + ' off the corridor at ' + g.x + ',' + g.y);
      }
      assert(!(g.fright && (g.loc === 'eyes' || g.loc === 'entering')), 'blue eyes');
      assert(g.fright === false || s.frightT > 0, 'blue with no fright on');
    });
    assert(s.dotsLeft >= 0 && s.dotsLeft <= 244, 'dots left: ' + s.dotsLeft);
    assert(s.lives >= 0, 'lives');
  }

  test('random input through thousands of ticks keeps every actor in the corridors', function () {
    var ticks = 0;
    [11, 12, 13, 14].forEach(function (seed) {
      var rng = seeded(seed);
      var s = G.create(seed);
      var stalled = [0, 0, 0, 0];
      for (var i = 0; i < 30000; i++) {
        var input = rng() < 0.08 ? Math.floor(rng() * 4) : NONE;
        var before = { score: s.score };
        G.tick(s, input);
        ticks++;
        checkInvariants(s, before);
        if (s.phase === 'play') {
          s.ghosts.forEach(function (g, id) {
            var moved = g.x !== g.prevX || g.y !== g.prevY;
            stalled[id] = moved || g.loc === 'house' ? 0 : stalled[id] + 1;
            assert(stalled[id] < 6, 'ghost ' + id + ' stalled, ' + g.loc + ' at ' + g.x + ',' + g.y);
          });
        }
        if (s.phase === 'over') s = G.create(seed + i);
      }
    });
    info('random input: ' + ticks + ' ticks checked');
  });

  test('the bot clears levels, on several seeds, with the same checks on every tick', function () {
    var lines = [];
    [1, 2, 3, 4, 5].forEach(function (seed) {
      var s = G.create(seed);
      s.lives = 30;
      var cap = 60 * 60 * 20;
      while (s.level < 4 && s.phase !== 'over' && cap-- > 0) {
        var before = { score: s.score };
        G.tick(s, PM.bot.choose(s));
        checkInvariants(s, before);
      }
      lines.push('seed ' + seed + ': level ' + s.level + ', score ' + s.score + ', lives lost ' + (30 + (s.extraLife ? 1 : 0) - s.lives));
      assert(s.level >= 4, 'stuck on level ' + s.level + ' with seed ' + seed);
    });
    info('bot, 30 lives: ' + lines.join('; '));
  });

  test('the bot sometimes clears the first level on the normal three lives', function () {
    var cleared = 0, tries = 10;
    var scores = [];
    for (var seed = 100; seed < 100 + tries; seed++) {
      var s = G.create(seed);
      var cap = 60 * 60 * 10;
      while (s.phase !== 'over' && s.level === 1 && cap-- > 0) G.tick(s, PM.bot.choose(s));
      if (s.level > 1) cleared++;
      scores.push(s.score);
    }
    info('bot, 3 lives: cleared level 1 in ' + cleared + ' of ' + tries + ' games, scores ' + scores.join(', '));
    assert(cleared > 0, 'never cleared level 1');
  });

  test('the same seed and input always play out the same', function () {
    function play() {
      var s = G.create(42);
      for (var i = 0; i < 8000; i++) G.tick(s, PM.bot.choose(s));
      return JSON.stringify(s);
    }
    eq(play(), play());
  });

  test('a game survives being cloned through JSON', function () {
    var s = G.create(9);
    for (var i = 0; i < 2000; i++) G.tick(s, PM.bot.choose(s));
    var c = clone(s);
    for (i = 0; i < 2000; i++) {
      var d = PM.bot.choose(s);
      G.tick(s, d);
      G.tick(c, d);
    }
    eq(JSON.stringify(c), JSON.stringify(s));
  });

  // ---- The page: keys, loop, drawing ----

  // Their own storage keys, so opening this page can't touch the real high score.
  var STORAGE = 'pacman-test.';
  try {
    localStorage.removeItem(STORAGE + 'high');
    localStorage.removeItem(STORAGE + 'sound');
  } catch (e) { /* storage unavailable */ }

  UI.start({ manual: true, seed: 7, storagePrefix: STORAGE });

  function storedValue(name) {
    return localStorage.getItem(STORAGE + name);
  }

  function press(code, key, extra) {
    var init = { code: code, key: key || code, bubbles: true, cancelable: true };
    Object.keys(extra || {}).forEach(function (k) { init[k] = extra[k]; });
    var e = new KeyboardEvent('keydown', init);
    document.dispatchEvent(e);
    return e;
  }

  var clock = 0;
  function frames(n, step) {
    for (var i = 0; i < n; i++) {
      clock += step || 16.67;
      UI.frame(clock);
    }
  }

  function fresh(seed) {
    UI.newGame(seed || 7, 'wait');
    frames(1);
  }

  test('nothing moves until the first key, which starts the game', function () {
    fresh();
    frames(30);
    eq(UI.state().tick, 0);
    eq(UI.mode(), 'wait');
    var e = press('ArrowLeft', 'ArrowLeft');
    assert(e.defaultPrevented, 'arrow keys must not scroll the page');
    eq(UI.mode(), 'run');
    frames(30);
    assert(UI.state().tick > 0, 'ticking');
  });

  test('arrow keys and WASD both steer, on any keyboard layout', function () {
    [['ArrowUp', 'ArrowUp', UP], ['ArrowLeft', 'ArrowLeft', LEFT], ['ArrowDown', 'ArrowDown', DOWN], ['ArrowRight', 'ArrowRight', RIGHT],
     ['KeyW', 'w', UP], ['KeyA', 'a', LEFT], ['KeyS', 's', DOWN], ['KeyD', 'd', RIGHT],
     ['KeyW', 'z', UP], ['KeyA', 'q', LEFT]].forEach(function (c) {
      fresh();
      press(c[0], c[1]);
      frames(3);
      eq(UI.state().pac.want, c[2], c[0] + ' typing ' + c[1]);
    });
  });

  test('browser shortcuts are left alone', function () {
    fresh();
    var e = press('KeyW', 'w', { ctrlKey: true });
    assert(!e.defaultPrevented, 'not blocked');
    eq(UI.mode(), 'wait', 'did not start');
    e = press('KeyR', 'r', { metaKey: true });
    assert(!e.defaultPrevented, 'not blocked');
  });

  test('P pauses and resumes, and a held P does not flip back and forth', function () {
    fresh();
    press('ArrowLeft', 'ArrowLeft');
    frames(5);
    press('KeyP', 'p');
    eq(UI.mode(), 'pause');
    var t = UI.state().tick;
    frames(30);
    eq(UI.state().tick, t, 'no ticks while paused');
    press('KeyP', 'p', { repeat: true });
    eq(UI.mode(), 'pause', 'held key');
    press('KeyP', 'p');
    eq(UI.mode(), 'run');
    frames(5);
    assert(UI.state().tick > t, 'ticking again');
  });

  test('an arrow key also resumes from a pause', function () {
    fresh();
    press('ArrowLeft', 'ArrowLeft');
    frames(5);
    press('KeyP', 'p');
    press('ArrowUp', 'ArrowUp');
    eq(UI.mode(), 'run');
  });

  test('losing focus pauses, with no burst of ticks on return', function () {
    fresh();
    press('ArrowLeft', 'ArrowLeft');
    frames(5);
    window.dispatchEvent(new Event('blur'));
    eq(UI.mode(), 'pause');
    var t = UI.state().tick;
    clock += 600000;
    UI.frame(clock);
    eq(UI.state().tick, t);
    press('KeyP', 'p');
    clock += 600000;
    UI.frame(clock);
    assert(UI.state().tick - t <= 6, 'at most 100 ms of ticks, got ' + (UI.state().tick - t));
  });

  test('M toggles the sound and the choice is stored', function () {
    fresh();
    var was = PM.sound.isMuted();
    press('KeyM', 'm');
    eq(PM.sound.isMuted(), !was);
    eq(document.getElementById('sound').textContent, was ? 'Sound on' : 'Sound off');
    eq(storedValue('sound'), was ? 'on' : 'off');
    press('KeyM', ';');
    eq(PM.sound.isMuted(), !was, 'by the letter typed, not the key position');
    press('Semicolon', 'm');
    eq(PM.sound.isMuted(), was);
  });

  test('Enter restarts only after game over', function () {
    fresh(3);
    press('ArrowLeft', 'ArrowLeft');
    frames(2);
    var s = UI.state();
    press('Enter', 'Enter');
    eq(UI.state(), s, 'same game while playing');
    s.phase = 'over';
    s.lives = 0;
    press('Enter', 'Enter');
    assert(UI.state() !== s, 'a new game');
    eq(UI.mode(), 'run');
    eq(UI.state().phase, 'ready');
  });

  test('New game asks first during a game, and stays paused on cancel', function () {
    var realConfirm = window.confirm;
    var asked = 0;
    try {
      fresh();
      press('ArrowLeft', 'ArrowLeft');
      frames(2);
      var s = UI.state();
      window.confirm = function () { asked++; return false; };
      document.getElementById('new-game').click();
      eq(asked, 1);
      eq(UI.state(), s, 'same game');
      eq(UI.mode(), 'pause');
      window.confirm = function () { asked++; return true; };
      document.getElementById('new-game').click();
      eq(asked, 2);
      assert(UI.state() !== s, 'a new game');
      eq(UI.mode(), 'run');
      fresh();
      document.getElementById('new-game').click();
      eq(asked, 2, 'no question before the first key');
    } finally {
      window.confirm = realConfirm;
    }
  });

  test('the score line follows the game and the high score is stored', function () {
    fresh();
    var s = UI.state();
    s.score = 1234567;
    s.level = 3;
    s.lives = 3;
    frames(1);
    eq(document.getElementById('score').textContent, '1234567');
    eq(document.getElementById('high').textContent, '1234567');
    eq(document.getElementById('level').textContent, '3');
    eq(document.getElementById('lives').children.length, 2, 'spare lives');
    press('ArrowLeft', 'ArrowLeft');
    press('KeyP', 'p');
    eq(storedValue('high'), '1234567');
    s.lives = 1;
    frames(1);
    eq(document.getElementById('lives').children.length, 0, 'no spare lives');
  });

  test('the status line changes with the state of the game', function () {
    var status = document.getElementById('status');
    fresh();
    assert(status.textContent.indexOf('Press an arrow key') === 0, 'wait: ' + status.textContent);
    press('ArrowLeft', 'ArrowLeft');
    assert(status.textContent.indexOf('Arrow keys') === 0, 'run: ' + status.textContent);
    press('KeyP', 'p');
    assert(status.textContent.indexOf('Paused') === 0, 'pause: ' + status.textContent);
    press('KeyP', 'p');
    var s = UI.state();
    s.score = 90;
    s.phase = 'over';
    frames(1);
    eq(status.textContent, 'Game over. You scored 90. Press Enter to play again.');
  });

  test('the game runs at 60 ticks a second whatever the frame rate', function () {
    [6.944, 16.667, 33.333].forEach(function (step) {
      fresh(5);
      press('ArrowLeft', 'ArrowLeft');
      var count = Math.round(10000 / step);
      frames(count, step);
      // The first frame after a key press only starts the clock.
      var expected = (count - 1) * step * 60 / 1000;
      var ticks = UI.state().tick;
      assert(Math.abs(ticks - expected) <= 1, 'step ' + step + ' ms: ' + ticks + ' ticks, expected ' + expected);
    });
  });

  test('frame rate never changes what happens in the game', function () {
    function plain(seed, ticks) {
      var s = G.create(seed);
      for (var i = 0; i < ticks; i++) G.tick(s, i === 0 ? LEFT : NONE);
      return JSON.stringify(s);
    }
    var rng = seeded(77);
    [
      function () { return 6.944; },
      function () { return 16.667; },
      function () { return 33.333; },
      function () { return 2 + rng() * 60; }
    ].forEach(function (nextStep, which) {
      fresh(21);
      press('ArrowLeft', 'ArrowLeft');
      while (UI.state().tick < 1500) frames(1, nextStep());
      eq(JSON.stringify(UI.state()), plain(21, UI.state().tick), 'cadence ' + which);
    });
  });

  // ---- Drawing ----

  function pixel(x, y) {
    var d = document.getElementById('game').getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]].join();
  }

  function rgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join();
  }

  test('the canvas shows the right colours at every tile size', function () {
    var palette = PM.render.readPalette();
    [8, 12, 16, 24, 33].forEach(function (T) {
      UI.resizeTo(28 * T, 31 * T, 1);
      eq(UI.tile(), T);
      fresh();
      var s = UI.state();
      press('ArrowLeft', 'ArrowLeft'); // takes the start message off the maze
      frames(1);
      // Pac-Man's middle: his mouth opens to the left, so look just right of centre.
      eq(pixel(s.pac.x * T / 8 + T / 4, s.pac.y * T / 8), rgb(palette.pac), 'Pac-Man at T=' + T);
      // Blinky, above his own eyes.
      eq(pixel(s.ghosts[BLINKY].x * T / 8, (s.ghosts[BLINKY].y - 5) * T / 8), rgb(palette.ghosts[BLINKY]), 'Blinky at T=' + T);
      // A dot in the top-left corridor.
      eq(pixel(1.5 * T, 1.5 * T), rgb(palette.dot), 'dot at T=' + T);
      // Beside that dot: open corridor.
      eq(pixel(1.5 * T, 2 * T - 1 - T / 4 + T / 8), rgb(palette.mazeBg), 'corridor at T=' + T);
      // Inside the block of wall at the top left of the maze.
      eq(pixel(3.5 * T, 3.5 * T), rgb(palette.wall), 'wall at T=' + T);
      // Inside the ghost house, away from the ghosts.
      eq(pixel(11.5 * T, 13.3 * T), rgb(palette.mazeBg), 'house at T=' + T);
      // The door.
      eq(pixel(13.5 * T, 12.5 * T + 1), rgb(palette.door), 'door at T=' + T);
    });
  });

  test('every phase draws without an error', function () {
    var canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = 248;
    var ctx = canvas.getContext('2d');
    var palette = PM.render.readPalette();
    ['ready', 'play', 'eat', 'dying', 'clear', 'over'].forEach(function (phase) {
      [1, 5, 9, 13].forEach(function (level) {
        var s = G.create(1, level);
        s.phase = phase;
        s.phaseT = 10;
        s.fruitT = 50;
        s.popup = { x: 112, y: 140, value: 400, t: 5 };
        s.frightT = 40;
        s.ghosts[PINKY].fright = true;
        s.ghosts[INKY].loc = 'eyes';
        s.ghosts[CLYDE].loc = 'entering';
        PM.render.draw(ctx, s, 0.5, 8, palette, phase === 'over' ? null : 'PAUSED');
      });
    });
  });

  test('the fruit is gone once the game is over', function () {
    var T = 16;
    var canvas = document.createElement('canvas');
    canvas.width = 28 * T;
    canvas.height = 31 * T;
    var ctx = canvas.getContext('2d');
    var palette = PM.render.readPalette();
    var red = rgb(palette.red);
    function fruitPixels(phase) {
      var s = G.create(1);
      s.phase = phase;
      s.fruitT = 100;
      PM.render.draw(ctx, s, 1, T, palette, null);
      var d = ctx.getImageData(13 * T, 16 * T, 2 * T, 3 * T).data;
      var count = 0;
      for (var i = 0; i < d.length; i += 4) {
        if ([d[i], d[i + 1], d[i + 2]].join() === red) count++;
      }
      return count;
    }
    assert(fruitPixels('play') > 0, 'shown during play');
    eq(fruitPixels('over'), 0, 'gone at game over');
  });

  test('actors at the tunnel edge are drawn on both sides', function () {
    var T = 16;
    UI.resizeTo(28 * T, 31 * T, 1);
    var palette = PM.render.readPalette();
    fresh();
    var s = UI.state();
    s.pac.x = 1;
    s.pac.prevX = 1;
    s.pac.y = R.centre(14);
    s.pac.prevY = s.pac.y;
    s.pac.dir = LEFT;
    press('ArrowLeft', 'ArrowLeft'); // takes the start message off the maze
    frames(1);
    var y = (s.pac.y + 4) * T / 8; // below the mouth
    eq(pixel(28 * T - 3, y), rgb(palette.pac), 'other side');
    eq(pixel(3, y), rgb(palette.pac), 'this side');
  });

  test('the tile size fits the window at every display scale', function () {
    [1, 1.25, 1.5, 2, 3].forEach(function (dpr) {
      [[1920, 1000], [1366, 620], [800, 600], [500, 900], [2560, 1300]].forEach(function (size) {
        var f = PM.render.fit(size[0], size[1], dpr);
        eq(f.T, Math.floor(f.T), 'whole device pixels');
        eq(f.width, 28 * f.T);
        eq(f.height, 31 * f.T);
        assert(f.cssWidth <= size[0] + 0.001, 'too wide at ' + dpr + ' on ' + size);
        assert(f.cssHeight <= size[1] + 0.001, 'too tall at ' + dpr + ' on ' + size);
        assert(Math.floor((size[0] * dpr) / 28) === f.T || Math.floor((size[1] * dpr) / 31) === f.T, 'not the largest');
        eq(Math.round(f.cssWidth * dpr), f.width, 'device pixels line up');
      });
    });
    eq(PM.render.fit(50, 50, 1).T, 8, 'never below the minimum');
  });

  test('the canvas is sized again when the space for it changes, with no resize event', function () {
    var stage = document.getElementById('stage');
    fresh();
    stage.style.height = '496px';
    stage.style.width = '448px';
    frames(1);
    eq(UI.tile(), 16, 'grown');
    stage.style.height = '248px';
    stage.style.width = '224px';
    frames(1);
    eq(UI.tile(), 8, 'shrunk');
    stage.style.height = '';
    stage.style.width = '';
  });

  test('the canvas lines up with device pixels even inside a fractional layout', function () {
    var stage = document.getElementById('stage');
    var dpr = 1.25;
    UI.resizeTo(301, 400, dpr);
    var box = stage.getBoundingClientRect();
    var canvas = document.getElementById('game');
    var left = box.left + parseFloat(canvas.style.left);
    var top = box.top + parseFloat(canvas.style.top);
    assert(Math.abs(left * dpr - Math.round(left * dpr)) < 0.001, 'left ' + left);
    assert(Math.abs(top * dpr - Math.round(top * dpr)) < 0.001, 'top ' + top);
    UI.resizeTo(224, 248, 1);
  });

  // ---- Sound ----

  test('every sound plays without an error, muted or not', function () {
    var was = PM.sound.isMuted();
    PM.sound.unlock();
    PM.sound.handle(PM.sound.EVENTS);
    var s = G.create(1);
    s.phase = 'play';
    PM.sound.update(s, true);
    s.frightT = 10;
    PM.sound.update(s, true);
    s.ghosts[BLINKY].loc = 'eyes';
    PM.sound.update(s, true);
    PM.sound.update(s, false);
    PM.sound.setMuted(!was);
    PM.sound.handle(['dot']);
    PM.sound.setMuted(was);
    PM.sound.suspend();
  });

  test('every event the game raises has a sound', function () {
    var raised = {};
    for (var seed = 1; seed <= 3; seed++) {
      var s = G.create(seed);
      s.lives = 5;
      s.score = 9000;
      var cap = 60 * 60 * 6;
      while (s.level < 2 && s.phase !== 'over' && cap-- > 0) {
        G.tick(s, PM.bot.choose(s));
        s.events.forEach(function (e) { raised[e] = true; });
      }
    }
    Object.keys(raised).forEach(function (e) {
      assert(PM.sound.EVENTS.indexOf(e) !== -1, 'no sound for ' + e);
    });
    ['start', 'dot', 'energizer', 'death', 'clear', 'life'].forEach(function (e) {
      assert(raised[e], 'never raised: ' + e);
    });
    info('events seen in play: ' + Object.keys(raised).sort().join(', '));
  });

  test('the tests never touch the real high score or sound setting', function () {
    var realHigh = localStorage.getItem('pacman.high');
    var realSound = localStorage.getItem('pacman.sound');
    eq(storedValue('high'), '1234567', 'the test score went to its own key');
    assert(realHigh !== '1234567', 'real high score');
    press('KeyM', 'm');
    press('KeyM', 'm');
    eq(localStorage.getItem('pacman.sound'), realSound);
  });

  // ---- Report ----

  var list = document.getElementById('results');
  results.forEach(function (r) {
    var li = document.createElement('li');
    li.className = r.info ? 'info' : r.ok ? 'pass' : 'fail';
    li.textContent = (r.info ? 'i ' : r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.error ? ': ' + r.error : '');
    list.appendChild(li);
  });

  var tests = results.filter(function (r) { return !r.info; });
  var failed = tests.filter(function (r) { return !r.ok; }).length;
  var summary = document.getElementById('summary');
  summary.textContent = failed ? failed + ' of ' + tests.length + ' tests failed' : 'All ' + tests.length + ' tests passed';
  summary.className = failed ? 'fail' : 'pass';
  document.title = summary.textContent;
})();
