/* Pac-Man — the simulation. One tick() is one 60th of a second. Pure logic, no DOM. */
(function () {
  'use strict';

  var R = PM.rules;
  var AI = PM.ai;
  var LEFT = R.LEFT, NONE = R.NONE;
  var DX = R.DX, DY = R.DY;

  // All durations are in ticks.
  var READY_FIRST = 270;
  var READY_NEXT = 120;
  var EAT_FREEZE = 60;
  var DYING_PAUSE = 45;  // everything stands still before the death animation
  var DYING_TICKS = DYING_PAUSE + 90;
  var CLEAR_TICKS = 150;
  var FRUIT_TICKS = 570;
  var POPUP_TICKS = 90;
  var FLASH_TICKS = 14;  // how long each half of a fright flash lasts

  var HIT = 4;           // actors touch within this many pixels on both axes
  var START_LIVES = 3;
  var EXTRA_LIFE_AT = 10000;
  var FRUIT_AT = [70, 170];

  // ---- Setting up ----

  function placeActors(state) {
    var counts = state.ghosts.map(function (g) { return g.dotCount; });
    state.pac = {
      x: R.PAC_START.x,
      y: R.PAC_START.y,
      prevX: R.PAC_START.x,
      prevY: R.PAC_START.y,
      dir: LEFT,
      want: NONE,   // the last direction asked for, kept until it can be used
      acc: 0,
      stall: 0,     // ticks left standing still after eating
      travel: 0     // pixels moved, for the mouth animation
    };
    state.ghosts = [R.BLINKY, R.PINKY, R.INKY, R.CLYDE].map(function (id) {
      return AI.createGhost(id, counts[id] || 0);
    });
    state.frightT = 0;
    state.combo = 0;
    state.fruitT = 0;
    state.popup = null;
    state.eatenId = -1;
    state.noDotT = 0;
    state.modeI = 0;
    state.modeT = R.schedule(state.level)[0];
  }

  function startLevel(state) {
    state.pellets = R.createPellets();
    state.dotsLeft = 244;
    state.dotsEaten = 0;
    state.useGlobal = false;
    state.globalDots = 0;
    state.elroyHold = false;
    state.ghosts = [];
    placeActors(state);
    state.phase = 'ready';
    state.phaseT = READY_NEXT;
  }

  // A plain object of integers, strings and flags, so a game can be cloned through JSON.
  function create(seed, level) {
    var state = {
      seed: seed | 0,
      tick: 0,
      level: level || 1,
      lives: START_LIVES,
      score: 0,
      extraLife: false,
      startPending: true,
      events: []
    };
    startLevel(state);
    state.phaseT = READY_FIRST;
    return state;
  }

  // ---- Helpers ----

  function addScore(state, points) {
    state.score += points;
    if (!state.extraLife && state.score >= EXTRA_LIFE_AT) {
      state.extraLife = true;
      state.lives++;
      state.events.push('life');
    }
  }

  // Wrap-aware, so actors on either side of the tunnel seam can touch.
  function touching(a, x, y) {
    var dx = Math.abs(a.x - x);
    dx = Math.min(dx, R.WIDTH - dx);
    return dx <= HIT && Math.abs(a.y - y) <= HIT;
  }

  function isFlashing(state) {
    return state.frightT > 0 &&
      state.frightT <= R.flashCount(state.level) * FLASH_TICKS * 2 &&
      Math.floor(state.frightT / FLASH_TICKS) % 2 === 0;
  }

  // ---- Pac-Man ----

  function pacSpeed(state) {
    var sp = R.speeds(state.level);
    return state.frightT > 0 ? sp.pacFright : sp.pac;
  }

  // Is the way blocked? Pac-Man can always run on to the centre of the tile he is in.
  function blocked(p, d) {
    var pos = DX[d] ? p.x : p.y;
    var off = pos % R.TILE, mid = R.TILE / 2;
    if (DX[d] + DY[d] > 0 ? off < mid : off > mid) return false;
    return !R.isOpen(R.tileOf(p.x) + DX[d], R.tileOf(p.y) + DY[d]);
  }

  // He turns as soon as the tile next to him in that direction is open, at any offset.
  function canTake(p, d) {
    if (d === R.opposite(p.dir)) return !blocked(p, d);
    return R.isOpen(R.tileOf(p.x) + DX[d], R.tileOf(p.y) + DY[d]);
  }

  function toward(pos, goal) {
    return pos < goal ? pos + 1 : pos > goal ? pos - 1 : pos;
  }

  function energize(state) {
    var ticks = R.frightTicks(state.level);
    state.combo = 0;
    if (ticks > 0) {
      state.frightT = ticks;
      state.ghosts.forEach(function (g) {
        if (g.loc !== 'eyes' && g.loc !== 'entering') g.fright = true;
      });
    }
    AI.reverseAll(state);
  }

  function eatPellet(state) {
    var p = state.pac;
    var i = R.index(R.tileOf(p.x), R.tileOf(p.y));
    var kind = state.pellets[i];
    if (!kind) return;
    state.pellets[i] = 0;
    state.dotsLeft--;
    state.dotsEaten++;
    AI.onPelletEaten(state);
    if (kind === R.DOT) {
      addScore(state, 10);
      p.stall = 1;
      state.events.push('dot');
    } else {
      addScore(state, 50);
      p.stall = 3;
      energize(state);
      state.events.push('energizer');
    }
    if (FRUIT_AT.indexOf(state.dotsEaten) !== -1) state.fruitT = FRUIT_TICKS;
    if (state.dotsLeft === 0) {
      state.phase = 'clear';
      state.phaseT = CLEAR_TICKS;
      state.events.push('clear');
    }
  }

  function stepPac(state) {
    var p = state.pac;
    if (p.want !== NONE && p.want !== p.dir && canTake(p, p.want)) p.dir = p.want;
    if (blocked(p, p.dir)) return;
    p.x = R.wrapX(p.x + DX[p.dir]);
    p.y += DY[p.dir];
    // Off the corridor's middle after a turn: close the gap a pixel at a time. This is
    // what makes cutting a corner faster, as in the arcade game.
    if (DX[p.dir]) p.y = toward(p.y, R.centre(R.tileOf(p.y)));
    else p.x = toward(p.x, R.centre(R.tileOf(p.x)));
    p.travel++;
    eatPellet(state);
  }

  function movePac(state) {
    var p = state.pac;
    if (p.stall > 0) {
      p.stall--;
      return;
    }
    p.acc += pacSpeed(state);
    while (p.acc >= 80 && state.phase === 'play') {
      p.acc -= 80;
      stepPac(state);
    }
  }

  // ---- Touching things ----

  function eatGhost(state, g) {
    state.combo++;
    var points = 200 << Math.min(state.combo - 1, 3);
    addScore(state, points);
    state.popup = { x: g.x, y: g.y, value: points, t: EAT_FREEZE };
    state.eatenId = g.id;
    AI.sendHome(state, g);
    state.phase = 'eat';
    state.phaseT = EAT_FREEZE;
    state.events.push('ghost');
  }

  // One ghost per call: a second ghost on the same spot gets its turn after the freeze.
  function collide(state) {
    var p = state.pac;
    for (var i = 0; i < state.ghosts.length; i++) {
      var g = state.ghosts[i];
      if (g.loc === 'house' || g.loc === 'eyes' || g.loc === 'entering') continue;
      if (!touching(p, g.x, g.y)) continue;
      if (g.fright) {
        eatGhost(state, g);
      } else {
        state.phase = 'dying';
        state.phaseT = DYING_TICKS;
        state.events.push('death');
      }
      return;
    }
  }

  function updateFruit(state) {
    if (state.fruitT <= 0) return;
    state.fruitT--;
    if (touching(state.pac, R.FRUIT_POS.x, R.FRUIT_POS.y)) {
      var points = R.fruit(state.level).points;
      addScore(state, points);
      state.fruitT = 0;
      state.popup = { x: R.FRUIT_POS.x, y: R.FRUIT_POS.y, value: points, t: POPUP_TICKS };
      state.events.push('fruit');
    }
  }

  // ---- Timers ----

  function endFright(state) {
    state.ghosts.forEach(function (g) { g.fright = false; });
  }

  // The scatter/chase clock stands still during fright. When fright ends ghosts carry on
  // without turning round; every scatter/chase switch makes them reverse.
  function updateMode(state) {
    if (state.frightT > 0) {
      state.frightT--;
      if (state.frightT === 0) endFright(state);
      return;
    }
    if (state.modeT < 0) return;
    state.modeT--;
    if (state.modeT === 0) {
      state.modeI++;
      state.modeT = R.schedule(state.level)[state.modeI];
      AI.reverseAll(state);
    }
  }

  // ---- The tick ----

  function remember(a) {
    a.prevX = a.x;
    a.prevY = a.y;
  }

  function tickPlay(state) {
    updateMode(state);
    movePac(state);
    if (state.phase !== 'play') return; // the last dot beats a touch on the same tick
    state.ghosts.forEach(function (g) { AI.moveGhost(state, g); });
    AI.updateHouse(state);
    collide(state);
    if (state.phase === 'play') updateFruit(state);
  }

  // Everything stands still except the eyes of ghosts eaten earlier.
  function tickEat(state) {
    state.ghosts.forEach(function (g) {
      if (g.id !== state.eatenId && (g.loc === 'eyes' || g.loc === 'entering')) AI.moveGhost(state, g);
    });
    if (--state.phaseT > 0) return;
    state.eatenId = -1;
    state.phase = 'play';
    collide(state);
  }

  function tickDying(state) {
    if (--state.phaseT > 0) return;
    state.lives--;
    if (state.lives <= 0) {
      state.phase = 'over';
      return;
    }
    // From now on ghosts leave the house by the global dot count, until Clyde is out.
    state.useGlobal = true;
    state.globalDots = 0;
    state.elroyHold = true;
    placeActors(state);
    state.phase = 'ready';
    state.phaseT = READY_NEXT;
  }

  function tickClear(state) {
    if (--state.phaseT > 0) return;
    state.level++;
    startLevel(state);
  }

  function tick(state, input) {
    state.events = [];
    state.tick++;
    if (input !== undefined && input !== NONE) state.pac.want = input;
    remember(state.pac);
    state.ghosts.forEach(remember);
    if (state.popup && --state.popup.t <= 0) state.popup = null;

    if (state.phase === 'ready') {
      if (state.startPending) {
        state.startPending = false;
        state.events.push('start');
      }
      if (--state.phaseT <= 0) state.phase = 'play';
    } else if (state.phase === 'play') {
      tickPlay(state);
    } else if (state.phase === 'eat') {
      tickEat(state);
    } else if (state.phase === 'dying') {
      tickDying(state);
    } else if (state.phase === 'clear') {
      tickClear(state);
    }
  }

  PM.game = {
    DYING_PAUSE: DYING_PAUSE,
    DYING_TICKS: DYING_TICKS,
    CLEAR_TICKS: CLEAR_TICKS,
    create: create,
    tick: tick,
    touching: touching,
    isFlashing: isFlashing
  };
})();
