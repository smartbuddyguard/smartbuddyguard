// Shared world constants. Imported by both the node server and the browser client.

export const TILE = 32;

// City layout: the map is a grid of cells. Every cell holds a 4 tile wide road
// on its top/left edge and a 10x10 tile building block in the remaining space.
export const ROAD_TILES = 4;
export const BLOCK_TILES = 10;
export const CELL_TILES = ROAD_TILES + BLOCK_TILES; // 14
export const GRID = 10; // cells per axis
export const MAP_TILES = GRID * CELL_TILES + ROAD_TILES; // closing road on far edge
export const MAP_SIZE = MAP_TILES * TILE;

export const LANE_OFFSET = 26; // distance of a lane centre from the road centre

// Tile kinds (values stored in city.tiles)
export const T_ROAD = 0;
export const T_SIDEWALK = 1;
export const T_BUILDING = 2;
export const T_PARK = 3;
export const T_WATER = 4;

// Simulation
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
export const NET_HZ = 15;
export const INPUT_HZ = 30;
export const INTERP_DELAY = 110; // ms of render delay used for entity interpolation
export const VIEW_RADIUS = 1250; // server only streams entities within this radius

// Entity type ids used on the wire
export const E_PLAYER = 1;
export const E_CAR = 2;
export const E_PED = 3;
export const E_PICKUP = 4;

// Player
export const PLAYER_RADIUS = 9;
export const PLAYER_ACCEL = 1400;
export const PLAYER_MAX_SPEED = 168;
export const PLAYER_FRICTION = 9;
export const PLAYER_MAX_HP = 100;
export const RESPAWN_TIME = 3.0;

// Cars
export const CAR_TYPES = [
  // name,      len, wid, maxSpeed, accel, grip, mass, hp,  body,      roof
  { id: 0, name: 'Sedan',   len: 58, wid: 30, max: 430, acc: 300, grip: 7.5, mass: 1.0, hp: 240, body: '#d8483f', roof: '#a4322c' },
  { id: 1, name: 'Taxi',    len: 60, wid: 30, max: 420, acc: 295, grip: 7.4, mass: 1.0, hp: 240, body: '#e8b53a', roof: '#c08f22' },
  { id: 2, name: 'Sport',   len: 56, wid: 28, max: 560, acc: 430, grip: 9.0, mass: 0.85, hp: 190, body: '#38a3d9', roof: '#2b7fab' },
  { id: 3, name: 'Van',     len: 70, wid: 34, max: 350, acc: 230, grip: 6.2, mass: 1.5, hp: 340, body: '#e3e3e3', roof: '#b9b9b9' },
  { id: 4, name: 'Truck',   len: 88, wid: 38, max: 300, acc: 200, grip: 5.4, mass: 2.2, hp: 460, body: '#5b7f4e', roof: '#3f5c36' },
  { id: 5, name: 'Police',  len: 62, wid: 31, max: 500, acc: 380, grip: 8.6, mass: 1.1, hp: 300, body: '#22314f', roof: '#e9edf5' },
  { id: 6, name: 'Bug',     len: 50, wid: 28, max: 380, acc: 280, grip: 7.0, mass: 0.9, hp: 200, body: '#8e6ec8', roof: '#6f52a3' }
];
export const CAR_POLICE = 5;

// Weapons
export const WEAPONS = [
  { id: 0, name: 'Fists',   dmg: 14, rate: 0.32, range: 34,  spread: 0.00, auto: true,  ammo: Infinity, kick: 0, sfx: 'punch' },
  { id: 1, name: 'Pistol',  dmg: 26, rate: 0.30, range: 430, spread: 0.03, auto: false, ammo: 60,  kick: 2, sfx: 'pistol' },
  { id: 2, name: 'Uzi',     dmg: 17, rate: 0.09, range: 400, spread: 0.09, auto: true,  ammo: 180, kick: 1, sfx: 'uzi' },
  { id: 3, name: 'Shotgun', dmg: 15, rate: 0.75, range: 300, spread: 0.16, auto: false, ammo: 30,  kick: 5, pellets: 6, sfx: 'shotgun' },
  { id: 4, name: 'Rocket',  dmg: 130, rate: 1.2, range: 620, spread: 0.01, auto: false, ammo: 8,   kick: 8, splash: 105, sfx: 'rocket' }
];

// Pickups
export const P_PISTOL = 1;
export const P_UZI = 2;
export const P_SHOTGUN = 3;
export const P_ROCKET = 4;
export const P_HEALTH = 5;
export const P_ARMOUR = 6;
export const P_CASH = 7;
export const PICKUP_RESPAWN = 22; // seconds

// Wanted system
export const MAX_WANTED = 5;
export const WANTED_DECAY = 26; // seconds without crime to lose one star
export const CRIME_KILL_PED = 1.0;
export const CRIME_KILL_COP = 2.0;
export const CRIME_SHOOT = 0.34;
export const CRIME_RUNOVER = 0.8;

export const MAX_PEDS = 90;
export const MAX_TRAFFIC = 60;
export const MAX_PARKED = 45;
export const MAX_POLICE = 12;
