// SELATARA HEAT — config.js
// Single source of truth for the palette and every tuning number in the game.
// Public API: SH.Config (palette day/night, world layout, vehicle/weapon data).
(function (SH) {
  'use strict';

  var Config = {
    // ---- World layout (metres; x east, z south, sea along the south edge) ----
    world: {
      halfX: 620, halfZ: 520,
      beachZ: 252, waterZ: 292,
      avenuesX: [-480, -360, -240, -120, 0, 120, 240, 360, 480],
      streetsZ: [-420, -300, -180, -60, 60, 180, 228],
      ringX: 560, ringZ: 460,
      roadHalf: 5.6, sidewalk: 3.2, laneOffset: 2.9,
      spawn: { x: -360, z: 96, heading: 0 }
    },

    // ---- Palette: one controlled set, day and night variants ----
    palette: {
      day: {
        skyTop: 0x1f8fe0, skyBand: 0x4db2ec, skyMid: 0x6ec3f2, skyLow: 0xd9f2ff, fog: 0xcfe9f7,
        sun: 0xfff0d0, sunIntensity: 1.35, hemiSky: 0xbfe3ff, hemiGround: 0x6a5a4a,
        hemiIntensity: 0.8, ambient: 0.35, water: 0x1f9ec4, sand: 0xf2dca6,
        asphalt: 0x4a4442, sidewalk: 0xb0a496, grass: 0x4db356
      },
      dusk: {
        // Natural-sky revision (user, 2026-11-19): a real sunset keeps
        // a BLUE dome — deep blue zenith, steel-blue band, and the gold
        // only low at the horizon where the sun sprite adds its local
        // glow. No magenta wash; neon lives in the city, not the sky.
        skyTop: 0x2c4a73, skyBand: 0x6f87b3, skyMid: 0xcf9a5e, skyLow: 0xffc98a, fog: 0xd8b490,
        sun: 0xffa040, sunIntensity: 1.15, hemiSky: 0xa9bde0, hemiGround: 0x59463a,
        hemiIntensity: 0.85, ambient: 0.3, water: 0x2a6a9e, sand: 0xe0af7c,
        asphalt: 0x3a3638, sidewalk: 0x8a7264, grass: 0x3f7a3a
      },
      night: {
        skyTop: 0x040814, skyBand: 0x0c1730, skyMid: 0x152540, skyLow: 0x1e324e, fog: 0x111e30,
        // Art Pass 3 (night readability): the night floor is raised on
        // purpose — blue hemisphere + a real ambient floor, so faces,
        // clothes and car paint stay readable and nothing falls to a
        // pure-black silhouette. (Purple cast removed in the natural-
        // sky revision: night is blue, not violet.)
        sun: 0x8aa8ff, sunIntensity: 0.3, hemiSky: 0x3d5a8a, hemiGround: 0x1e2632,
        hemiIntensity: 0.8, ambient: 0.42, water: 0x10344c, sand: 0x655a49,
        asphalt: 0x201f26, sidewalk: 0x3a3844, grass: 0x1c3d27
      }
    },

    neon: { pink: 0xff4fa3, cyan: 0x37e0ff, yellow: 0xffd23f, windowWarm: 0xffca7a },

    buildingPalettes: {
      pelita: [0xf2e3c6, 0xbfe3ea, 0x9fd8c0, 0x3f9db5, 0xe8d8b0],
      ruko: [0x5fd4b8, 0xff7a6b, 0xffc93c, 0x1fb5b0, 0xff5fa2, 0xc96f4a],
      karat: [0x8a7a68, 0x9a8f85, 0x7a6a58, 0xa89880],
      mawar: [0xf7ead2, 0xf2d8c9, 0xe3ecd8, 0xffffff],
      kencana: [0xf7ead2, 0xffd9c9, 0xbfe3ea, 0xf2e3c6]
    },

    // ---- Districts: name, bounds, flavour, and the colour each district
    // wears on the city map (minimap prerender + pause map) ----
    districts: [
      { id: 'pelita', name: 'PELITA HEIGHTS', x0: -252, x1: 252, z0: -432, z1: -48, minH: 26, maxH: 74, map: '#3e7ea6' },
      { id: 'ruko', name: 'RUKO SENJA', x0: -492, x1: -252, z0: -432, z1: 192, minH: 7, maxH: 13, map: '#c96f4a' },
      { id: 'mawar', name: 'BUKIT MAWAR', x0: 252, x1: 492, z0: -432, z1: 0, minH: 6, maxH: 11, map: '#8fce9e' },
      { id: 'karat', name: 'PELABUHAN KARAT', x0: 252, x1: 572, z0: 0, z1: 240, minH: 9, maxH: 16, map: '#b5652a' },
      { id: 'taman', name: 'TAMAN ARUS', x0: -132, x1: 132, z0: -72, z1: 192, minH: 0, maxH: 0, map: '#2e6b34' },
      { id: 'kencana', name: 'PANTAI KENCANA', x0: -492, x1: 492, z0: 192, z1: 292, minH: 8, maxH: 18, map: '#e0c184' }
    ],

    // ---- Pulau Seberang: the small island across the bay, reached by the
    // bridge from the Kencana shore (ellipse in world metres) ----
    island: { x: 430, z: 452, rx: 104, rz: 70, name: 'PULAU SEBERANG' },

    // ---- Player ----
    player: {
      walkSpeed: 4.2, sprintSpeed: 7.4, accel: 26, jumpSpeed: 5.4, gravity: -14,
      radius: 0.45, height: 1.75, maxHealth: 100, maxArmor: 100
    },

    // ---- Vehicles: arcade bicycle-model parameters per type ----
    vehicleTypes: {
      sedan: { label: 'Kijang Sedan', maxSpeed: 33, accel: 11, brake: 22, grip: 9, turn: 1.9, length: 4.4, width: 1.82, height: 1.45, mass: 1200, colors: [0xc94f4f, 0x4f7ac9, 0xe8e3d8, 0x3a3f4a, 0x7ac94f] },
      sport: { label: 'Arus GT Sport', maxSpeed: 47, accel: 17, brake: 26, grip: 11, turn: 2.3, length: 4.3, width: 1.88, height: 1.15, mass: 1050, colors: [0xffb020, 0xff4fa3, 0x37e0ff, 0xe83a3a, 0x22242c] },
      truck: { label: 'Bara Container Truck', maxSpeed: 24, accel: 7, brake: 17, grip: 7, turn: 1.4, length: 7.6, width: 2.5, height: 3.1, mass: 3200, colors: [0xd8d3c8, 0x7a8894, 0xc97a3a] },
      motor: { label: 'Selat Scooter', maxSpeed: 36, accel: 15, brake: 24, grip: 10, turn: 2.8, length: 2.1, width: 0.7, height: 1.15, mass: 220, colors: [0x37b24d, 0xff6b4a, 0x4f7ac9, 0xf2e3c6] },
      boat: { label: 'Kencana Speedboat', maxSpeed: 26, accel: 9, brake: 12, grip: 5, turn: 1.5, length: 6.4, width: 2.3, height: 1.5, mass: 900, colors: [0xffffff, 0xff8c5a] },
      police: { label: 'Selatara Patrol', maxSpeed: 40, accel: 14, brake: 24, grip: 10, turn: 2.1, length: 4.5, width: 1.85, height: 1.5, mass: 1250, colors: [0xf2f2f2] }
    },

    // ---- Weapons (combat lands in a later slice; data lives here) ----
    weapons: {
      fist: { label: 'Fists', damage: 9, rate: 2.4, range: 2.2, spread: 0, mag: Infinity, reload: 0 },
      pistol: { label: 'Pistol Senja 9mm', damage: 16, rate: 3.4, range: 90, spread: 0.012, mag: 12, reload: 1.1 },
      smg: { label: 'SMG Arus-9', damage: 11, rate: 10, range: 70, spread: 0.03, mag: 30, reload: 1.5 },
      shotgun: { label: 'Shotgun Pelabuhan', damage: 9, pellets: 7, rate: 1.15, range: 42, spread: 0.075, mag: 6, reload: 2.2 }
    },

    // ---- Police / wanted ----
    police: {
      station: { x: 8, z: -64 }, hospital: { x: -240, z: 188 },
      carsByStars: [0, 2, 3, 4, 5, 6],
      searchSeconds: [0, 9, 12, 15, 19, 24],   // hidden time needed to lose one star
      spawnDist: 135, despawnDist: 330,
      copDamage: 7, copFireRange: 40,
      bustedRadius: 6.5, bustedSeconds: 2.2,
      fineBase: 120, finePerStar: 110, wastedFine: 180
    },

    // ---- Pickups ----
    pickups: { health: 35, armor: 50, cashMin: 40, cashMax: 120 },

    // ---- Shops (economy.js reads every price from here) ----
    shops: {
      pistolAmmo: 60, smgAmmo: 90, shotgunAmmo: 110,
      smg: 1400, shotgun: 2100, armor: 500,
      repairPerHp: 6, spray: 350, meal: 45, rest: 0, save: 0, outfit: 150
    },

    // ---- Loop / performance ----
    loop: { step: 1 / 60, maxSteps: 5, trafficCount: 42, pedCount: 34, activeRadius: 340, despawnRadius: 420 },
    day: { startHour: 17.4, minutesPerSecond: 1.6 }
  };

  SH.Config = Config;
})(window.SH = window.SH || {});
