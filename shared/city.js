// Deterministic city generator. Server and clients build an identical city
// from the same seed, so only the seed has to travel over the network.

import {
  TILE, ROAD_TILES, BLOCK_TILES, CELL_TILES, GRID, MAP_TILES, MAP_SIZE,
  T_ROAD, T_SIDEWALK, T_BUILDING, T_PARK, T_WATER
} from './constants.js';
import { makeRng, randRange } from './util.js';

const BUILDING_PALETTE = [
  ['#4a4f5c', '#3a3e49'], ['#5c4a45', '#473833'], ['#4d5b4a', '#3b473a'],
  ['#59535f', '#443f4a'], ['#5f5747', '#4a4437'], ['#41505c', '#334049'],
  ['#6a5b52', '#52463f'], ['#3f4a55', '#313a43']
];

// Roads run along the top/left edge of every cell, so a road centre line sits
// at tile index i * CELL_TILES + ROAD_TILES / 2 for i in [0..GRID].
export function roadCenterTile(i) { return i * CELL_TILES + ROAD_TILES / 2; }
export function roadCenterWorld(i) { return roadCenterTile(i) * TILE; }

export function generateCity(seed) {
  const rng = makeRng(seed);
  const tiles = new Uint8Array(MAP_TILES * MAP_TILES);
  const solid = new Uint8Array(MAP_TILES * MAP_TILES);
  const buildings = [];
  const props = [];

  // Everything starts as road, blocks are stamped on top.
  tiles.fill(T_ROAD);

  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const bx = cx * CELL_TILES + ROAD_TILES;
      const by = cy * CELL_TILES + ROAD_TILES;
      const roll = rng();

      // Sidewalk ring around the whole block.
      for (let y = 0; y < BLOCK_TILES; y++) {
        for (let x = 0; x < BLOCK_TILES; x++) {
          tiles[(by + y) * MAP_TILES + (bx + x)] = T_SIDEWALK;
        }
      }

      if (roll < 0.09) {
        // Park block: walkable green with a few trees.
        for (let y = 1; y < BLOCK_TILES - 1; y++) {
          for (let x = 1; x < BLOCK_TILES - 1; x++) {
            tiles[(by + y) * MAP_TILES + (bx + x)] = T_PARK;
          }
        }
        const trees = 5 + ((rng() * 6) | 0);
        for (let t = 0; t < trees; t++) {
          props.push({
            type: 'tree',
            x: (bx + randRange(rng, 1.5, BLOCK_TILES - 1.5)) * TILE,
            y: (by + randRange(rng, 1.5, BLOCK_TILES - 1.5)) * TILE,
            r: randRange(rng, 12, 19)
          });
        }
        continue;
      }

      if (roll < 0.13) {
        // Water / dock block.
        for (let y = 1; y < BLOCK_TILES - 1; y++) {
          for (let x = 1; x < BLOCK_TILES - 1; x++) {
            tiles[(by + y) * MAP_TILES + (bx + x)] = T_WATER;
            solid[(by + y) * MAP_TILES + (bx + x)] = 1;
          }
        }
        continue;
      }

      // Otherwise: split the 8x8 interior into 1-4 buildings.
      const inner = { x: bx + 1, y: by + 1, w: BLOCK_TILES - 2, h: BLOCK_TILES - 2 };
      const parts = splitBlock(rng, inner, rng() < 0.45 ? 1 : (rng() < 0.6 ? 2 : 4));
      for (const p of parts) {
        if (p.w < 2 || p.h < 2) continue;
        const pal = BUILDING_PALETTE[(rng() * BUILDING_PALETTE.length) | 0];
        buildings.push({
          x: p.x * TILE, y: p.y * TILE, w: p.w * TILE, h: p.h * TILE,
          top: pal[0], side: pal[1],
          height: 6 + ((rng() * 14) | 0),
          windows: rng() < 0.8
        });
        for (let y = p.y; y < p.y + p.h; y++) {
          for (let x = p.x; x < p.x + p.w; x++) {
            tiles[y * MAP_TILES + x] = T_BUILDING;
            solid[y * MAP_TILES + x] = 1;
          }
        }
      }
    }
  }

  // Road graph: one node per intersection, four way connected.
  const nodes = [];
  const nodeAt = (i, j) => (i < 0 || j < 0 || i > GRID || j > GRID) ? -1 : j * (GRID + 1) + i;
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      nodes.push({
        i, j,
        x: roadCenterWorld(i),
        y: roadCenterWorld(j),
        links: [nodeAt(i, j - 1), nodeAt(i + 1, j), nodeAt(i, j + 1), nodeAt(i - 1, j)]
          .filter(n => n >= 0)
      });
    }
  }

  // Sidewalk points used to spawn pedestrians and players.
  const walkSpots = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const bx = i * CELL_TILES + ROAD_TILES;
      const by = j * CELL_TILES + ROAD_TILES;
      for (const [ox, oy] of [[0.5, 0.5], [BLOCK_TILES - 0.5, 0.5], [0.5, BLOCK_TILES - 0.5], [BLOCK_TILES - 0.5, BLOCK_TILES - 0.5], [BLOCK_TILES / 2, 0.5], [BLOCK_TILES / 2, BLOCK_TILES - 0.5]]) {
        walkSpots.push({ x: (bx + ox) * TILE, y: (by + oy) * TILE });
      }
    }
  }

  const city = { seed, tiles, solid, buildings, props, nodes, walkSpots, size: MAP_SIZE, tilesPerSide: MAP_TILES };
  city.pickupSpots = buildPickupSpots(city, makeRng(seed ^ 0x9e3779b9));
  return city;
}

function splitBlock(rng, r, count) {
  let parts = [r];
  while (parts.length < count) {
    parts.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const p = parts.shift();
    if (p.w >= p.h && p.w >= 4) {
      const cut = 2 + ((rng() * (p.w - 3)) | 0);
      parts.push({ x: p.x, y: p.y, w: cut, h: p.h }, { x: p.x + cut, y: p.y, w: p.w - cut, h: p.h });
    } else if (p.h >= 4) {
      const cut = 2 + ((rng() * (p.h - 3)) | 0);
      parts.push({ x: p.x, y: p.y, w: p.w, h: cut }, { x: p.x, y: p.y + cut, w: p.w, h: p.h - cut });
    } else {
      parts.push(p);
      break;
    }
  }
  return parts;
}

function buildPickupSpots(city, rng) {
  const spots = [];
  // Pistols are the common street find, rockets the rare one.
  const kinds = [1, 2, 1, 5, 6, 7, 3, 5, 7, 4];
  for (let n = 0; n < 60; n++) {
    const s = city.walkSpots[(rng() * city.walkSpots.length) | 0];
    if (!s) break;
    spots.push({ x: s.x, y: s.y, kind: kinds[n % kinds.length] });
  }
  return spots;
}

export function tileAt(city, x, y) {
  const tx = (x / TILE) | 0, ty = (y / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return T_BUILDING;
  return city.tiles[ty * MAP_TILES + tx];
}

export function isSolidTile(city, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
  return city.solid[ty * MAP_TILES + tx] === 1;
}

export function isSolidAt(city, x, y) {
  return isSolidTile(city, (x / TILE) | 0, (y / TILE) | 0);
}
