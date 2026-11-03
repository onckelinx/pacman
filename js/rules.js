/* Pac-Man — the maze and the level tables. Pure logic, no DOM. */
(function () {
  'use strict';

  var PM = (window.PM = window.PM || {});

  var COLS = 28;
  var ROWS = 31;
  var TILE = 8;   // simulation pixels per tile
  var WIDTH = COLS * TILE;
  var TICKS = 60; // simulation ticks per second

  // Directions, in the order that breaks ghost ties: up, left, down, right.
  var UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3, NONE = -1;
  var DX = [0, -1, 0, 1];
  var DY = [-1, 0, 1, 0];

  var BLINKY = 0, PINKY = 1, INKY = 2, CLYDE = 3;
  var DOT = 1, ENERGIZER = 2;

  // '#' wall, '.' dot, 'o' energizer, '-' ghost door. A space is open only if it can be
  // reached from Pac-Man's start, which leaves out the house and the blocks at the sides.
  var MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '     #.##### ## #####.#     ',
    '     #.##          ##.#     ',
    '     #.## ###--### ##.#     ',
    '######.## #      # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '     #.## ######## ##.#     ',
    '     #.##          ##.#     ',
    '     #.## ######## ##.#     ',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################'
  ];

  // Positions in simulation pixels. x = 112 falls between columns 13 and 14.
  var PAC_START = { x: 112, y: 188 };
  var FRUIT_POS = { x: 112, y: 140 };
  var DOOR_X = 112;      // the column ghosts use to go through the door
  var DOOR_Y = 92;       // just outside the door, on the corridor
  var HOUSE_Y = 116;     // the middle of the house
  var BOB_MIN_Y = 112;   // waiting ghosts bob between these two
  var BOB_MAX_Y = 120;
  var DOOR_TILE = { col: 13, row: 11 };

  var GHOST_START = [
    { x: 112, y: 92, dir: LEFT },
    { x: 112, y: 116, dir: DOWN },
    { x: 96, y: 116, dir: UP },
    { x: 128, y: 116, dir: UP }
  ];
  var HOME_X = [112, 112, 96, 128]; // where each ghost revives inside the house

  // Scatter corners sit outside the grid, so never use them as an index.
  var SCATTER = [
    { col: 25, row: -3 },
    { col: 2, row: -3 },
    { col: 27, row: 32 },
    { col: 0, row: 32 }
  ];

  var NO_UP = [[12, 11], [15, 11], [12, 23], [15, 23]];

  // ---- Tile queries ----

  function index(col, row) { return row * COLS + col; }
  function wrapCol(col) { return ((col % COLS) + COLS) % COLS; }
  function wrapX(x) { return ((x % WIDTH) + WIDTH) % WIDTH; }
  function tileOf(px) { return Math.floor(px / TILE); }
  function centre(tile) { return tile * TILE + TILE / 2; }
  function opposite(dir) { return (dir + 2) % 4; }

  var OPEN = (function () {
    var open = [];
    var i;
    for (i = 0; i < COLS * ROWS; i++) open.push(0);
    var start = index(13, 23);
    open[start] = 1;
    var queue = [start];
    while (queue.length) {
      var at = queue.pop();
      var row = Math.floor(at / COLS), col = at % COLS;
      for (var d = 0; d < 4; d++) {
        var nr = row + DY[d], nc = wrapCol(col + DX[d]);
        if (nr < 0 || nr >= ROWS) continue;
        var ch = MAZE[nr].charAt(nc);
        if (open[index(nc, nr)] || (ch !== '.' && ch !== 'o' && ch !== ' ')) continue;
        open[index(nc, nr)] = 1;
        queue.push(index(nc, nr));
      }
    }
    return open;
  })();

  // Can Pac-Man or a roaming ghost stand on this tile? Columns wrap through the tunnel.
  function isOpen(col, row) {
    if (row < 0 || row >= ROWS) return false;
    return OPEN[index(wrapCol(col), row)] === 1;
  }

  // For drawing: everything that is not a corridor, including what lies outside the grid.
  function isWall(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    return OPEN[index(col, row)] === 0;
  }

  function isTunnel(col, row) {
    return row === 14 && (col <= 5 || col >= 22);
  }

  function isNoUp(col, row) {
    for (var i = 0; i < NO_UP.length; i++) {
      if (NO_UP[i][0] === col && NO_UP[i][1] === row) return true;
    }
    return false;
  }

  function createPellets() {
    var pellets = [];
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        var ch = MAZE[row].charAt(col);
        pellets.push(ch === '.' ? DOT : ch === 'o' ? ENERGIZER : 0);
      }
    }
    return pellets;
  }

  // ---- Level tables ----

  // Speeds in percent, where 80 is one pixel per tick. Each row applies from its level on.
  var SPEEDS = [
    { from: 1, pac: 80, ghost: 75, tunnel: 40, pacFright: 90, ghostFright: 50 },
    { from: 2, pac: 90, ghost: 85, tunnel: 45, pacFright: 95, ghostFright: 55 },
    { from: 5, pac: 100, ghost: 95, tunnel: 50, pacFright: 100, ghostFright: 60 },
    { from: 21, pac: 90, ghost: 95, tunnel: 50, pacFright: 90, ghostFright: 60 }
  ];

  // Blinky speeds up as the dots run out: dots left and speed for each of the two stages.
  var ELROY = [
    { from: 1, dots1: 20, speed1: 80, dots2: 10, speed2: 85 },
    { from: 2, dots1: 30, speed1: 90, dots2: 15, speed2: 95 },
    { from: 3, dots1: 40, speed1: 90, dots2: 20, speed2: 95 },
    { from: 5, dots1: 40, speed1: 100, dots2: 20, speed2: 105 },
    { from: 6, dots1: 50, speed1: 100, dots2: 25, speed2: 105 },
    { from: 9, dots1: 60, speed1: 100, dots2: 30, speed2: 105 },
    { from: 12, dots1: 80, speed1: 100, dots2: 40, speed2: 105 },
    { from: 15, dots1: 100, speed1: 100, dots2: 50, speed2: 105 },
    { from: 19, dots1: 120, speed1: 100, dots2: 60, speed2: 105 }
  ];

  // Scatter and chase take turns, starting with scatter. Ticks, with -1 for forever.
  var SCHEDULES = [
    { from: 1, ticks: [420, 1200, 420, 1200, 300, 1200, 300, -1] },
    { from: 2, ticks: [420, 1200, 420, 1200, 300, 61980, 1, -1] },
    { from: 5, ticks: [300, 1200, 300, 1200, 300, 62220, 1, -1] }
  ];

  var FRUITS = [
    { from: 1, kind: 'cherry', points: 100 },
    { from: 2, kind: 'strawberry', points: 300 },
    { from: 3, kind: 'orange', points: 500 },
    { from: 5, kind: 'apple', points: 700 },
    { from: 7, kind: 'melon', points: 1000 },
    { from: 9, kind: 'ship', points: 2000 },
    { from: 11, kind: 'bell', points: 3000 },
    { from: 13, kind: 'key', points: 5000 }
  ];

  // Seconds of fright for levels 1 to 19. From level 20 on there is none.
  var FRIGHT_SECONDS = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1, 0];

  var DOT_LIMITS = [[0, 0, 30, 60], [0, 0, 0, 50], [0, 0, 0, 0]]; // per ghost, for levels 1, 2, 3+
  var GLOBAL_LIMITS = [0, 7, 17, 32]; // per ghost, after a life is lost

  function lookup(table, level) {
    var row = table[0];
    for (var i = 1; i < table.length; i++) {
      if (table[i].from <= level) row = table[i];
    }
    return row;
  }

  function speeds(level) { return lookup(SPEEDS, level); }
  function elroy(level) { return lookup(ELROY, level); }
  function schedule(level) { return lookup(SCHEDULES, level).ticks; }
  function fruit(level) { return lookup(FRUITS, level); }

  function frightTicks(level) {
    return (level <= FRIGHT_SECONDS.length ? FRIGHT_SECONDS[level - 1] : 0) * TICKS;
  }

  // How many times ghosts flash before fright ends: fewer when it only lasts a second.
  function flashCount(level) {
    return frightTicks(level) === TICKS ? 3 : 5;
  }

  function dotLimit(level, id) {
    return DOT_LIMITS[Math.min(level, DOT_LIMITS.length) - 1][id];
  }

  // A waiting ghost is forced out after this long without Pac-Man eating anything.
  function noDotTicks(level) {
    return (level >= 5 ? 3 : 4) * TICKS;
  }

  PM.rules = {
    COLS: COLS,
    ROWS: ROWS,
    TILE: TILE,
    WIDTH: WIDTH,
    TICKS: TICKS,
    UP: UP,
    LEFT: LEFT,
    DOWN: DOWN,
    RIGHT: RIGHT,
    NONE: NONE,
    DX: DX,
    DY: DY,
    BLINKY: BLINKY,
    PINKY: PINKY,
    INKY: INKY,
    CLYDE: CLYDE,
    DOT: DOT,
    ENERGIZER: ENERGIZER,
    MAZE: MAZE,
    PAC_START: PAC_START,
    FRUIT_POS: FRUIT_POS,
    DOOR_X: DOOR_X,
    DOOR_Y: DOOR_Y,
    HOUSE_Y: HOUSE_Y,
    BOB_MIN_Y: BOB_MIN_Y,
    BOB_MAX_Y: BOB_MAX_Y,
    DOOR_TILE: DOOR_TILE,
    GHOST_START: GHOST_START,
    HOME_X: HOME_X,
    SCATTER: SCATTER,
    GLOBAL_LIMITS: GLOBAL_LIMITS,
    index: index,
    wrapCol: wrapCol,
    wrapX: wrapX,
    tileOf: tileOf,
    centre: centre,
    opposite: opposite,
    isOpen: isOpen,
    isWall: isWall,
    isTunnel: isTunnel,
    isNoUp: isNoUp,
    createPellets: createPellets,
    speeds: speeds,
    elroy: elroy,
    schedule: schedule,
    fruit: fruit,
    frightTicks: frightTicks,
    flashCount: flashCount,
    dotLimit: dotLimit,
    noDotTicks: noDotTicks
  };
})();
