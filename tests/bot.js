/* Pac-Man — a simple player for the tests. It reads the state and answers with a direction. */
(function () {
  'use strict';

  var R = PM.rules;
  var SIZE = R.COLS * R.ROWS;
  var FAR = 9999;
  // A tile counts as safe if Pac-Man gets there this many steps ahead of any ghost. The
  // game is deterministic, so the same choices would repeat the same death: each life
  // takes a different risk.
  var MARGINS = [3, 1, 4, 2];

  function neighbour(tile, d) {
    var col = tile % R.COLS, row = Math.floor(tile / R.COLS);
    var nc = col + R.DX[d], nr = row + R.DY[d];
    if (!R.isOpen(nc, nr)) return -1;
    return R.index(R.wrapCol(nc), nr);
  }

  function isThreat(state, g) {
    if (g.loc === 'house' || g.loc === 'eyes' || g.loc === 'entering') return false;
    return !g.fright || state.frightT < 90; // about to turn dangerous again
  }

  // Steps from the nearest dangerous ghost to every tile.
  function ghostDistances(state) {
    var dist = new Int16Array(SIZE).fill(FAR);
    var queue = [];
    state.ghosts.forEach(function (g) {
      if (!isThreat(state, g)) return;
      var col = R.tileOf(g.x), row = R.tileOf(g.y);
      if (!R.isOpen(col, row)) { // on the rail by the door
        col = R.DOOR_TILE.col;
        row = R.DOOR_TILE.row;
      }
      var t = R.index(col, row);
      dist[t] = 0;
      queue.push(t);
    });
    for (var i = 0; i < queue.length; i++) {
      for (var d = 0; d < 4; d++) {
        var n = neighbour(queue[i], d);
        if (n >= 0 && dist[n] === FAR) {
          dist[n] = dist[queue[i]] + 1;
          queue.push(n);
        }
      }
    }
    return dist;
  }

  // The first step towards the nearest pellet it can reach safely. With no safe pellet,
  // it heads for the neighbouring tile furthest from any ghost.
  function choose(state) {
    var p = state.pac;
    var start = R.index(R.tileOf(p.x), R.tileOf(p.y));
    var ghosts = ghostDistances(state);
    var depth = new Int16Array(SIZE).fill(-1);
    var firstStep = new Int8Array(SIZE).fill(-1);
    var margin = MARGINS[state.lives % MARGINS.length];
    depth[start] = 0;
    var queue = [start];
    for (var i = 0; i < queue.length; i++) {
      var at = queue[i];
      if (at !== start && state.pellets[at]) return firstStep[at];
      for (var d = 0; d < 4; d++) {
        var n = neighbour(at, d);
        if (n < 0 || depth[n] !== -1) continue;
        if (ghosts[n] < depth[at] + 1 + margin) continue;
        depth[n] = depth[at] + 1;
        firstStep[n] = at === start ? d : firstStep[at];
        queue.push(n);
      }
    }
    var best = p.dir, bestDist = -1;
    for (var e = 0; e < 4; e++) {
      var m = neighbour(start, e);
      if (m >= 0 && ghosts[m] > bestDist) {
        bestDist = ghosts[m];
        best = e;
      }
    }
    return best;
  }

  PM.bot = { choose: choose };
})();
