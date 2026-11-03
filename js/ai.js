/* Pac-Man — ghost behaviour: targets, turns and the house. Pure logic, no DOM. */
(function () {
  'use strict';

  var R = PM.rules;
  var UP = R.UP, LEFT = R.LEFT, DOWN = R.DOWN, RIGHT = R.RIGHT, NONE = R.NONE;
  var DX = R.DX, DY = R.DY;
  var BLINKY = R.BLINKY, PINKY = R.PINKY, INKY = R.INKY, CLYDE = R.CLYDE;

  var EYES_SPEED = 160;
  var HOUSE_SPEED = 40;
  var SHY_DISTANCE = 64; // Clyde runs for his corner inside 8 tiles (squared distance)

  // A ghost's location is one of:
  //   house     waiting inside, bobbing up and down
  //   leaving   on the rail from its place in the house to just outside the door
  //   roam      in the corridors
  //   eyes      eaten, heading back to the door
  //   entering  on the rail from the door to its place in the house
  // Fright is a separate flag on each ghost, so a revived ghost is dangerous among blue ones.
  function createGhost(id, dotCount) {
    var start = R.GHOST_START[id];
    return {
      id: id,
      x: start.x,
      y: start.y,
      prevX: start.x,
      prevY: start.y,
      dir: start.dir,
      nextDir: start.dir,  // the turn it will take at the next tile centre
      arrive: start.dir,   // its heading when it reached the last tile centre
      loc: id === BLINKY ? 'roam' : 'house',
      fright: false,
      exitRight: false,    // leaves the house to the right if a reversal came while inside
      acc: 0,
      dotCount: dotCount
    };
  }

  function random(state) {
    state.seed = (state.seed + 0x6d2b79f5) | 0;
    var t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  // ---- Targets ----

  // 0 normally, or Blinky's speed-up stage. It is held back after a death until Clyde is out.
  function elroyStage(state) {
    if (state.elroyHold) return 0;
    var e = R.elroy(state.level);
    if (state.dotsLeft <= e.dots2) return 2;
    if (state.dotsLeft <= e.dots1) return 1;
    return 0;
  }

  // The tile n ahead of Pac-Man. Facing up also shifts it n to the left: an arcade bug
  // that is part of how Pinky and Inky behave.
  function aheadOfPac(pac, n) {
    return {
      col: R.tileOf(pac.x) + DX[pac.dir] * n - (pac.dir === UP ? n : 0),
      row: R.tileOf(pac.y) + DY[pac.dir] * n
    };
  }

  function target(state, g) {
    if (g.loc === 'eyes') return R.DOOR_TILE;
    var scattering = state.modeI % 2 === 0;
    if (scattering && !(g.id === BLINKY && elroyStage(state) > 0)) return R.SCATTER[g.id];

    var pac = state.pac;
    var pacCol = R.tileOf(pac.x), pacRow = R.tileOf(pac.y);
    if (g.id === BLINKY) return { col: pacCol, row: pacRow };
    if (g.id === PINKY) return aheadOfPac(pac, 4);
    if (g.id === INKY) {
      var pivot = aheadOfPac(pac, 2);
      var blinky = state.ghosts[BLINKY];
      return {
        col: 2 * pivot.col - R.tileOf(blinky.x),
        row: 2 * pivot.row - R.tileOf(blinky.y)
      };
    }
    var dc = R.tileOf(g.x) - pacCol, dr = R.tileOf(g.y) - pacRow;
    return dc * dc + dr * dr >= SHY_DISTANCE ? { col: pacCol, row: pacRow } : R.SCATTER[CLYDE];
  }

  // ---- Choosing a direction ----

  // The direction to take at tile (col, row), on arriving there with this heading.
  // A ghost never turns back by choice. Frightened ghosts wander at random.
  function chooseDir(state, g, col, row, heading) {
    var back = R.opposite(heading);
    var d;
    if (g.fright) {
      var start = random(state) % 4;
      for (var i = 0; i < 4; i++) {
        d = (start + i) % 4;
        if (d !== back && R.isOpen(col + DX[d], row + DY[d])) return d;
      }
      return back;
    }
    var t = target(state, g);
    var noUp = g.loc === 'roam' && R.isNoUp(R.wrapCol(col), row);
    var best = NONE, bestDist = Infinity;
    for (d = 0; d < 4; d++) {
      if (d === back || (d === UP && noUp)) continue;
      var nc = col + DX[d], nr = row + DY[d];
      if (!R.isOpen(nc, nr)) continue;
      var dist = (nc - t.col) * (nc - t.col) + (nr - t.row) * (nr - t.row);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best === NONE ? back : best;
  }

  // The tile whose centre comes next along one axis, moving from pos in direction d (±1).
  function nextTile(pos, d) {
    var tile = R.tileOf(pos), c = R.centre(tile);
    if (d > 0) return pos < c ? tile : tile + 1;
    return pos > c ? tile : tile - 1;
  }

  // Re-plan the turn at the next tile centre.
  function aim(state, g) {
    var col = DX[g.dir] ? nextTile(g.x, DX[g.dir]) : R.tileOf(g.x);
    var row = DY[g.dir] ? nextTile(g.y, DY[g.dir]) : R.tileOf(g.y);
    g.nextDir = chooseDir(state, g, col, row, g.dir);
  }

  function atCentre(g) {
    return g.x % R.TILE === R.TILE / 2 && g.y % R.TILE === R.TILE / 2;
  }

  // Turn a roaming ghost back the way it came. On a tile centre it may have just turned
  // a corner, so "back" means against its heading on arrival, not its current one.
  function reverse(state, g) {
    if (g.loc === 'roam') {
      g.dir = R.opposite(atCentre(g) ? g.arrive : g.dir);
      aim(state, g);
    } else if (g.loc === 'house' || g.loc === 'leaving') {
      g.exitRight = true;
    }
  }

  function reverseAll(state) {
    state.ghosts.forEach(function (g) { reverse(state, g); });
  }

  // ---- Moving ----

  function ghostSpeed(state, g) {
    if (g.loc === 'eyes' || g.loc === 'entering') return EYES_SPEED;
    if (g.loc === 'house' || g.loc === 'leaving') return HOUSE_SPEED;
    var sp = R.speeds(state.level);
    if (R.isTunnel(R.tileOf(g.x), R.tileOf(g.y))) return sp.tunnel;
    if (g.fright) return sp.ghostFright;
    if (g.id === BLINKY) {
      var stage = elroyStage(state);
      if (stage === 2) return R.elroy(state.level).speed2;
      if (stage === 1) return R.elroy(state.level).speed1;
    }
    return sp.ghost;
  }

  function stepRoam(state, g) {
    g.x = R.wrapX(g.x + DX[g.dir]);
    g.y += DY[g.dir];
    if (g.loc === 'eyes' && g.x === R.DOOR_X && g.y === R.DOOR_Y) {
      g.loc = 'entering';
      g.dir = DOWN;
      return;
    }
    if (atCentre(g)) {
      g.arrive = g.dir;
      g.dir = g.nextDir;
      g.nextDir = chooseDir(state, g, R.tileOf(g.x) + DX[g.dir], R.tileOf(g.y) + DY[g.dir], g.dir);
    }
  }

  function stepHouse(g) {
    g.y += DY[g.dir];
    if (g.y <= R.BOB_MIN_Y) g.dir = DOWN;
    else if (g.y >= R.BOB_MAX_Y) g.dir = UP;
  }

  function moveTowards(g, axis, goal, plus, minus) {
    g.dir = g[axis] < goal ? plus : minus;
    g[axis] += g[axis] < goal ? 1 : -1;
  }

  function stepLeaving(state, g) {
    if (g.x !== R.DOOR_X && g.y !== R.HOUSE_Y) {
      moveTowards(g, 'y', R.HOUSE_Y, DOWN, UP);
    } else if (g.x !== R.DOOR_X) {
      moveTowards(g, 'x', R.DOOR_X, RIGHT, LEFT);
    } else if (g.y !== R.DOOR_Y) {
      moveTowards(g, 'y', R.DOOR_Y, DOWN, UP);
    } else {
      g.loc = 'roam';
      g.dir = g.exitRight ? RIGHT : LEFT;
      g.arrive = g.dir;
      g.exitRight = false;
      aim(state, g);
    }
  }

  function stepEntering(g) {
    if (g.y !== R.HOUSE_Y) {
      moveTowards(g, 'y', R.HOUSE_Y, DOWN, UP);
    } else if (g.x !== R.HOME_X[g.id]) {
      moveTowards(g, 'x', R.HOME_X[g.id], RIGHT, LEFT);
    } else {
      g.loc = 'leaving';
      g.fright = false;
      g.exitRight = false;
    }
  }

  function stepOne(state, g) {
    if (g.loc === 'house') stepHouse(g);
    else if (g.loc === 'leaving') stepLeaving(state, g);
    else if (g.loc === 'entering') stepEntering(g);
    else stepRoam(state, g);
  }

  function moveGhost(state, g) {
    g.acc += ghostSpeed(state, g);
    while (g.acc >= 80) {
      g.acc -= 80;
      stepOne(state, g);
    }
  }

  // ---- Being eaten ----

  function sendHome(state, g) {
    g.fright = false;
    if (g.loc === 'leaving' || (g.x === R.DOOR_X && g.y === R.DOOR_Y)) {
      g.loc = 'entering'; // on the rail or right at the door, so it goes straight in
      g.dir = DOWN;
    } else {
      g.loc = 'eyes';
      aim(state, g);
    }
  }

  // ---- The house ----

  // Pinky, then Inky, then Clyde.
  function firstWaiting(state) {
    for (var id = PINKY; id <= CLYDE; id++) {
      if (state.ghosts[id].loc === 'house') return state.ghosts[id];
    }
    return null;
  }

  function release(state, g) {
    g.loc = 'leaving';
    if (g.id === CLYDE) state.elroyHold = false;
  }

  function onPelletEaten(state) {
    state.noDotT = 0;
    if (state.useGlobal) {
      state.globalDots++;
    } else {
      var g = firstWaiting(state);
      if (g) g.dotCount++;
    }
  }

  function updateHouse(state) {
    state.noDotT++;
    var g = firstWaiting(state);
    if (!g) return;
    if (state.noDotT >= R.noDotTicks(state.level)) {
      state.noDotT = 0;
      release(state, g);
    } else if (state.useGlobal) {
      if (state.globalDots >= R.GLOBAL_LIMITS[g.id]) {
        release(state, g);
        if (g.id === CLYDE) state.useGlobal = false;
      }
    } else if (g.dotCount >= R.dotLimit(state.level, g.id)) {
      release(state, g);
    }
  }

  PM.ai = {
    createGhost: createGhost,
    elroyStage: elroyStage,
    target: target,
    chooseDir: chooseDir,
    aim: aim,
    reverse: reverse,
    reverseAll: reverseAll,
    ghostSpeed: ghostSpeed,
    moveGhost: moveGhost,
    sendHome: sendHome,
    onPelletEaten: onPelletEaten,
    updateHouse: updateHouse
  };
})();
