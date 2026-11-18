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
      roadHalf: 7, sidewalk: 3.2, laneOffset: 3.4,
      spawn: { x: -360, z: 96, heading: 0 }
    },

    // ---- Palette: one controlled set, day and night variants ----
    palette: {
      day: {
        skyTop: 0x4aa8dd, skyMid: 0x9fd0e8, skyLow: 0xffc98a, fog: 0xf7b98a,
        sun: 0xffd9a8, sunIntensity: 1.25, hemiSky: 0xffe3c0, hemiGround: 0x5a4a44,
        hemiIntensity: 0.75, ambient: 0.35, water: 0x2e8fb5, sand: 0xe8cf9f,
        asphalt: 0x4a4442, sidewalk: 0x9a8f85, grass: 0x5da85e
      },
      dusk: {
        skyTop: 0x3a4a8c, skyMid: 0xff8c5a, skyLow: 0xff6b4a, fog: 0xd98a6a,
        sun: 0xff9a5c, sunIntensity: 1.0, hemiSky: 0xc98a6a, hemiGround: 0x4a3a44,
        hemiIntensity: 0.68, ambient: 0.3, water: 0x2a6a94, sand: 0xc9a87a,
        asphalt: 0x3a3236, sidewalk: 0x6a5a58, grass: 0x3a6a3e
      },
      night: {
        skyTop: 0x0b1030, skyMid: 0x2a1b4a, skyLow: 0x1a1440, fog: 0x1c1838,
        sun: 0x8aa8ff, sunIntensity: 0.12, hemiSky: 0x33406e, hemiGround: 0x14101e,
        hemiIntensity: 0.35, ambient: 0.18, water: 0x14384f, sand: 0x6a5f4d,
        asphalt: 0x23202b, sidewalk: 0x3d3a4a, grass: 0x1e4028
      }
    },

    neon: { pink: 0xff4fa3, cyan: 0x37e0ff, yellow: 0xffd23f, windowWarm: 0xffca7a },

    buildingPalettes: {
      pelita: [0xf2e3c6, 0xbfe3ea, 0x9fd8c0, 0x3f9db5, 0xe8d8b0],
      ruko: [0xd97b5f, 0xf2e3c6, 0x9fd8c0, 0xe8b04b, 0xc96f4a],
      karat: [0x8a7a68, 0x9a8f85, 0x7a6a58, 0xa89880],
      mawar: [0xf7ead2, 0xf2d8c9, 0xe3ecd8, 0xffffff],
      kencana: [0xf7ead2, 0xffd9c9, 0xbfe3ea, 0xf2e3c6]
    },

    // ---- Districts: name, bounds, flavour ----
    districts: [
      { id: 'pelita', name: 'PELITA HEIGHTS', x0: -252, x1: 252, z0: -432, z1: -48, minH: 26, maxH: 74 },
      { id: 'ruko', name: 'RUKO SENJA', x0: -492, x1: -252, z0: -432, z1: 192, minH: 7, maxH: 13 },
      { id: 'mawar', name: 'BUKIT MAWAR', x0: 252, x1: 492, z0: -432, z1: 0, minH: 6, maxH: 11 },
      { id: 'karat', name: 'PELABUHAN KARAT', x0: 252, x1: 572, z0: 0, z1: 240, minH: 9, maxH: 16 },
      { id: 'taman', name: 'TAMAN ARUS', x0: -132, x1: 132, z0: -72, z1: 192, minH: 0, maxH: 0 },
      { id: 'kencana', name: 'PANTAI KENCANA', x0: -492, x1: 492, z0: 192, z1: 292, minH: 8, maxH: 18 }
    ],

    // ---- Player ----
    player: {
      walkSpeed: 4.2, sprintSpeed: 7.4, accel: 26, jumpSpeed: 5.4, gravity: -14,
      radius: 0.45, height: 1.75, maxHealth: 100, maxArmor: 100
    },

    // ---- Vehicles: arcade bicycle-model parameters per type ----
    vehicleTypes: {
      sedan: { label: 'Kijang Sedan', maxSpeed: 33, accel: 11, brake: 22, grip: 9, turn: 1.9, length: 4.4, width: 1.9, height: 1.45, mass: 1200, colors: [0xc94f4f, 0x4f7ac9, 0xe8e3d8, 0x3a3f4a, 0x7ac94f] },
      sport: { label: 'Arus GT Sport', maxSpeed: 47, accel: 17, brake: 26, grip: 11, turn: 2.3, length: 4.3, width: 1.95, height: 1.15, mass: 1050, colors: [0xffb020, 0xff4fa3, 0x37e0ff, 0xe83a3a, 0x22242c] },
      truck: { label: 'Bara Container Truck', maxSpeed: 24, accel: 7, brake: 17, grip: 7, turn: 1.4, length: 7.6, width: 2.5, height: 3.1, mass: 3200, colors: [0xd8d3c8, 0x7a8894, 0xc97a3a] },
      motor: { label: 'Selat Scooter', maxSpeed: 36, accel: 15, brake: 24, grip: 10, turn: 2.8, length: 2.1, width: 0.7, height: 1.15, mass: 220, colors: [0x37b24d, 0xff6b4a, 0x4f7ac9, 0xf2e3c6] },
      boat: { label: 'Kencana Speedboat', maxSpeed: 26, accel: 9, brake: 12, grip: 5, turn: 1.5, length: 6.4, width: 2.3, height: 1.5, mass: 900, colors: [0xffffff, 0xff8c5a] },
      police: { label: 'Selatara Patrol', maxSpeed: 40, accel: 14, brake: 24, grip: 10, turn: 2.1, length: 4.5, width: 1.95, height: 1.5, mass: 1250, colors: [0xf2f2f2] }
    },

    // ---- Weapons (combat lands in a later slice; data lives here) ----
    weapons: {
      fist: { label: 'Fists', damage: 9, rate: 2.4, range: 2.2, spread: 0, mag: Infinity, reload: 0 },
      pistol: { label: 'Pistol Senja 9mm', damage: 16, rate: 3.4, range: 90, spread: 0.012, mag: 12, reload: 1.1 },
      smg: { label: 'SMG Arus-9', damage: 11, rate: 10, range: 70, spread: 0.03, mag: 30, reload: 1.5 },
      shotgun: { label: 'Shotgun Pelabuhan', damage: 9, pellets: 7, rate: 1.15, range: 42, spread: 0.075, mag: 6, reload: 2.2 }
    },

    // ---- Loop / performance ----
    loop: { step: 1 / 60, maxSteps: 5, trafficCount: 42, pedCount: 34, activeRadius: 340, despawnRadius: 420 },
    day: { startHour: 17.4, minutesPerSecond: 1.6 }
  };

  SH.Config = Config;
})(window.SH = window.SH || {});
