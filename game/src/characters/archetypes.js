// SELATARA HEAT — characters/archetypes.js  (Character System, Stage C)
// THE archetype table: every human in the game is described HERE as
// data and built by the ONE factory (SH.CharFactory.create(id, seed)).
// All people, names, uniforms and insignia are ORIGINAL to Selatara;
// the police badge is a fictional patch that reads "POLISI" — no real
// agency insignia, no real city name.
//
// Schema (consumed by factory.js):
//   id, label, kind ('story' | 'police' | 'enemy' | 'ped')
//   body:  Rig.baseParams multipliers { H, legFrac, shoulder, waist,
//          hips, belly, thigh, headScale, handScale, neckR, skin }
//          — skin is an index into CharFactory.SKIN_TONES; omit it
//          and the seed picks the tone.
//   heightRange: [min, max] — seed-varied height (factory honours it
//          when body.H is absent).
//   face:  drawFace params { eyes, mouth, expr, blush, mustache,
//          beard, wrinkles, randomEyes }.
//   hair:  { style } fixed, or { styles: [...] } seed-picked; color
//          fixed hex or seed-picked; colors: [hex...] pins a
//          seed-picked SET (police stay black / dark brown — the
//          free HAIR_COLORS roll includes greys); clothColor(s)
//          for hijab cloth.
//   wear:  { top: { type, sleeve, color | colors, pattern, color2 |
//          colors2, rough }, bottom: {...}, shoes: hex | [hex...],
//          hat, hatColor, accessories: [...] } — `colors` arrays are
//          the seed-variation surface: same archetype, different seed
//          = a different person, never a clone.
//   idle:  preferred idle clip, gait: locomotion clip override,
//   walkSpeed: m/s flavour for Stage E, line: one optional bark.
//   lead:  true = inverted-hull outline (APPEAL PASS, story cast).
//   posture: CharAnim posture { hunch, slouch, stiff } — the
//          personality layer (kakek hunches, aparat stand stiff).
(function (SH) {
  'use strict';

  var LIST = [
    // ================= STORY CAST (fixed people, fixed look) ============
    {
      id: 'raka', label: 'Raka Pramudya (protagonis)', kind: 'story', lead: true,
      body: { H: 1.75, shoulder: 0.94, skin: 3 },
      head: { jaw: 'square' },
      // BODYFIX2: Raka's DEFAULT face is a subtle friendly smile
      // ('warm' in toon.js EXPRESSIONS) — the polish spec.
      face: { eyes: 'narrow', mouth: 'flat', expr: 'warm' },
      hair: { style: 'short', color: 0x17130f },
      wear: {
        // TOON REBUILD cast lock (Bos spec mapping): dark beanie,
        // orange jacket, yellow accent, brown backpack.
        top: { type: 'jacket', sleeve: 'long', color: 0xd8622a, color2: 0xf2b13c },
        bottom: { type: 'long', color: 0x23242c },
        shoes: 0xe8e4da, hat: 'beanie', hatColor: 0x1c1e24,
        accessories: ['backpack']
      },
      idle: 'idle', walkSpeed: 1.5,
      line: 'Satu antar terakhir. Habis itu gue berhenti. Mungkin.'
    },
    {
      id: 'mami', label: 'Mami Ratna (fixer)', kind: 'story', lead: true,
      body: { H: 1.68, hips: 1.06, waist: 0.92, skin: 2, handColor: 0x4a3826 },
      posture: { hunch: 0.22 },
      head: { jaw: 'taper' },
      face: { wrinkles: true, mouth: 'smile' },
      hair: { style: 'bun', color: 0xb8b0a4 },
      wear: {
        // TOON REBUILD cast lock: mechanic jacket (slate), work
        // trousers; oil-stained hands via body.handColor above.
        // BODYFIX round 4: SHORT sleeves = the rolled-sleeve read
        // (hem band + bare forearms + oily hands), average build.
        top: { type: 'jacket', sleeve: 'short', color: 0x51606e },
        bottom: { type: 'long', color: 0x2c3038 },
        shoes: 0x3a2c22, accessories: ['glasses', 'jewelry']
      },
      idle: 'talk', walkSpeed: 1.1,
      line: 'Di Selatara, semua orang punya harga. Kamu diskon.'
    },
    {
      id: 'varga', label: 'Komisaris Varga (polisi korup)', kind: 'story', lead: true,
      body: { H: 1.82, shoulder: 1.16, waist: 1.05, belly: 0.5, skin: 4 },
      posture: { stiff: 1 },
      head: { jaw: 'square' },
      face: { mustache: true, mouth: 'stern', stubble: true },
      hair: { style: 'short', color: 0x2b2b2e },
      wear: {
        top: { type: 'jacket', sleeve: 'long', color: 0x24303e },
        bottom: { type: 'long', color: 0x1f2733 },
        shoes: 0x14161a, hat: 'officer',
        accessories: ['sunglasses', 'badge', 'policePatch']
      },
      idle: 'idle', walkSpeed: 1.3,
      line: 'Hukum itu punya saya. Kamu cuma numpang lewat.'
    },
    {
      id: 'dario', label: 'Dario "Kapten" Latu (bos sindikat)', kind: 'story', lead: true,
      body: { H: 1.85, shoulder: 1.08, waist: 1.02, skin: 1 },
      head: { jaw: 'square' },
      face: { eyes: 'narrow', mouth: 'grin', stubble: true },
      hair: { style: 'slick', color: 0x1b1e28 },
      wear: {
        top: { type: 'blazer', sleeve: 'long', color: 0xe9e2d0 },
        bottom: { type: 'long', color: 0xd9d0ba },
        shoes: 0x4a3220, hat: 'fedora', hatColor: 0xe9e2d0,
        // BODYFIX2: 'blazerSet' = lapels / pockets / flat fold
        // shades / cuff bands (toon.js buildAccessories) so the
        // cream outfit stops reading as a mannequin.
        accessories: ['cigar', 'neckTattoo', 'blazerSet']
      },
      idle: 'idle_smoke', walkSpeed: 1.2,
      line: 'Pelabuhan ini dermaga saya. Kamu cuma ombak.'
    },

    // ================= POLICE (original uniform, fictional badge) ======
    {
      id: 'patrol', label: 'Polisi — Patrol', kind: 'police',
      body: {}, heightRange: [1.78, 1.90], posture: { stiff: 0.8 },
      head: { jaw: 'square' },
      face: { randomEyes: true, stubble: 0.5 },
      hair: { styles: ['buzz', 'short'], colors: [0x17130f, 0x101010, 0x2b1d12, 0x241a12] },
      wear: {
        top: { type: 'vest', sleeve: 'long', color: 0x1f3355 },
        bottom: { type: 'long', color: 0x1a2742 },
        shoes: 0x14161c, hat: 'officer',
        accessories: ['policePatch', 'radio', 'pistol', 'badge']
      },
      idle: 'idle', walkSpeed: 1.4
    },
    {
      id: 'detektif', label: 'Polisi — Detektif', kind: 'police',
      body: {}, heightRange: [1.68, 1.80],
      head: { jaw: 'square' },
      face: { randomEyes: true, stubble: 0.7 },
      hair: { styles: ['slick', 'quiff', 'undercut'], colors: [0x17130f, 0x101010, 0x2b1d12, 0x3a2415] },
      wear: {
        top: { type: 'tee', sleeve: 'long', colors: [0xd8d5cc, 0xb9c4cc, 0xe3ddcb] },
        bottom: { type: 'long', colors: [0x2c2f36, 0x23242c, 0x35302a] },
        shoes: [0x201a14, 0x14161a], accessories: ['tie', 'beltBadge']
      },
      idle: 'idle_phone', walkSpeed: 1.4
    },
    {
      id: 'swat', label: 'Polisi — SWAT', kind: 'police',
      body: { H: 1.84, shoulder: 1.18, waist: 1.02 }, posture: { stiff: 1 },
      head: { jaw: 'square' },
      face: {},
      hair: { style: 'buzz', color: 0x14161a },
      wear: {
        top: { type: 'vest', color: 0x191c22 },
        bottom: { type: 'long', color: 0x191c22 },
        shoes: 0x0e0f12, hat: 'helmet', hatColor: 0x191c22,
        accessories: ['visor', 'rifle']
      },
      idle: 'idle', walkSpeed: 1.5
    },
    {
      id: 'pilotHeli', label: 'Polisi — Pilot heli', kind: 'police',
      body: {}, heightRange: [1.70, 1.80],
      head: { jaw: 'square' },
      face: {},
      hair: { style: 'short', colors: [0x17130f, 0x101010, 0x2b1d12, 0x241a12] },
      wear: {
        top: { type: 'jacket', sleeve: 'long', color: 0x4a5548 },
        bottom: { type: 'long', color: 0x424c40 },
        shoes: 0x1c1a16, hat: 'helmet', hatColor: 0xdcd8ce,
        accessories: ['sunglasses', 'radio']
      },
      idle: 'idle', walkSpeed: 1.4
    },

    // ================= ENEMIES & ROLES =================================
    {
      id: 'sindikatHawaii', label: 'Sindikat — kemeja hawaii', kind: 'enemy',
      body: { shoulder: 1.04 }, heightRange: [1.68, 1.80],
      face: { mouth: 'grin', randomEyes: true },
      hair: { styles: ['short', 'quiff', 'messy', 'undercut'] },
      wear: {
        top: { type: 'tee', pattern: 'hawaii', colors: [0xf2e3c6, 0xd8e4ea, 0xf5d9c0], colors2: [0xe86a4a, 0xdd5a8a, 0xef8f3a] },
        bottom: { type: 'shorts', colors: [0x8a6a3c, 0x5a6e7a, 0x746a4f] },
        // COMBAT V7: shooter archetypes carry the factory pistol —
        // they fire in combat but were built unarmed (empty handR),
        // unlike penjagaGudang / police, who already had 'pistol'.
        shoes: [0x54443a, 0x2a2c33], accessories: ['armTattoo', 'pistol']
      },
      idle: 'idle_lean', walkSpeed: 1.3
    },
    {
      id: 'sindikatKulit', label: 'Sindikat — jaket kulit', kind: 'enemy',
      body: { shoulder: 1.14 }, heightRange: [1.70, 1.82],
      head: { jaw: 'square' },
      face: { eyes: 'narrow', mouth: 'flat', stubble: 0.7 },
      hair: { styles: ['slick', 'undercut', 'short'] },
      wear: {
        top: { type: 'jacket', sleeve: 'long', color: 0x2b2320, color2: 0xc23b2e, rough: 0.5 },
        bottom: { type: 'long', colors: [0x23242a, 0x1d1f26] },
        shoes: [0x1c1a16, 0x2a2019], accessories: ['armTattoo', 'pistol']
      },
      idle: 'idle', walkSpeed: 1.35
    },
    {
      id: 'penjagaGudang', label: 'Penjaga gudang', kind: 'enemy',
      body: { shoulder: 1.06 }, heightRange: [1.70, 1.83],
      head: { jaw: 'square' },
      face: { mouth: 'flat', randomEyes: true, stubble: 0.5 },
      hair: { style: 'cap', color: 0x2e3a2e },
      wear: {
        top: { type: 'tee', color2: 0xc23b2e, colors: [0x4c5548, 0x3c4652, 0x554e42] },
        bottom: { type: 'long', colors: [0x2e3238, 0x3a352c] },
        shoes: [0x1c1e24, 0x2a2019], accessories: ['pistol']
      },
      idle: 'idle', walkSpeed: 1.2
    },
    {
      id: 'kurir', label: 'Kurir sindikat', kind: 'enemy',
      body: { waist: 0.94 }, heightRange: [1.66, 1.78],
      face: { randomEyes: true },
      hair: { styles: ['cap', 'short', 'buzz'] },
      wear: {
        top: { type: 'jacket', sleeve: 'long', colors: [0xc84a30, 0x3868b8, 0xd8942e] },
        bottom: { type: 'long', colors: [0x23242c, 0x2c2f36] },
        shoes: [0x22242a, 0x1c1c20], accessories: ['bag']
      },
      idle: 'idle_phone', walkSpeed: 1.7
    },
    {
      id: 'preman', label: 'Preman dermaga', kind: 'enemy',
      body: { shoulder: 1.12, thigh: 1.08 }, heightRange: [1.72, 1.84],
      head: { jaw: 'square' },
      face: { mouth: 'stern', eyes: 'narrow', stubble: 0.9 },
      hair: { styles: ['buzz', 'bald', 'undercut'] },
      wear: {
        top: { type: 'vest', color2: 0xc23b2e, colors: [0x33302c, 0x402e28, 0x2c3436] },
        bottom: { type: 'shorts', colors: [0x3a3f45, 0x4a4038] },
        shoes: [0x2a2c33, 0x54443a], accessories: ['armTattoo', 'pistol']
      },
      idle: 'idle_lean', walkSpeed: 1.3
    },
    {
      id: 'timHeist', label: 'Tim heist bertopeng', kind: 'enemy',
      body: { shoulder: 1.05 }, heightRange: [1.72, 1.82],
      face: {},
      hair: { style: 'short', color: 0x101010 },
      wear: {
        top: { type: 'jacket', sleeve: 'long', color: 0x17181c },
        bottom: { type: 'long', color: 0x17181c },
        shoes: 0x0e0e10, accessories: ['mask', 'backpack', 'rifle']
      },
      idle: 'idle', walkSpeed: 1.5
    },

    // ================= PEDESTRIANS (>= 14, seed-varied) =================
    {
      id: 'turis', label: 'Pejalan — Turis', kind: 'ped',
      body: {}, heightRange: [1.62, 1.80],
      face: { blush: true, randomEyes: true },
      hair: { styles: ['long', 'ponytail', 'short', 'quiff', 'bob'] },
      wear: {
        top: { type: 'tee', pattern: 'hawaii', colors: [0xf2e3c6, 0xe8f0e2, 0xfdeeda], colors2: [0xe86a4a, 0xdd5a8a, 0xef8f3a] },
        bottom: { type: 'shorts', colors: [0x8a6a3c, 0x5a7a8a, 0xa89a72] },
        shoes: [0x54443a, 0xd8d3c8], hat: 'sunhat', accessories: ['camera', 'sunglasses']
      },
      idle: 'idle', walkSpeed: 1.1
    },
    {
      id: 'sekolah', label: 'Pejalan — Anak sekolah', kind: 'ped',
      body: { headScale: 1.12 }, heightRange: [1.34, 1.46],
      face: { randomEyes: true },
      hair: { styles: ['short', 'ponytail', 'bob'] },
      wear: {
        top: { type: 'tee', colors: [0xf5f2ea, 0xe8ecf2] },
        bottom: { type: 'shorts', colors: [0xb8302c, 0x2c4a8a] },
        shoes: [0x22242a, 0xd8d3c8], accessories: ['backpack']
      },
      idle: 'idle', walkSpeed: 1.3
    },
    {
      id: 'kantoran', label: 'Pejalan — Pekerja kantoran', kind: 'ped',
      body: {}, heightRange: [1.66, 1.80],
      head: { jaw: 'square' },
      face: { randomEyes: true, stubble: 0.35 },
      hair: { styles: ['slick', 'quiff', 'undercut'] },
      wear: {
        top: { type: 'blazer', sleeve: 'long', colors: [0x3a4152, 0x51473c, 0x2f3a4a] },
        bottom: { type: 'long', colors: [0x2c2f36, 0x23242c] },
        shoes: [0x201a14, 0x14161a], accessories: ['bag']
      },
      idle: 'idle_phone', walkSpeed: 1.5
    },
    {
      id: 'pedagang', label: 'Pejalan — Pedagang pasar', kind: 'ped',
      body: { waist: 1.04 }, heightRange: [1.62, 1.76],
      face: { randomEyes: true },
      hair: { style: 'peci' },
      wear: {
        top: { type: 'tee', pattern: 'batik', colors: [0x8a5a2c, 0x6e4a3a, 0x7a3a2c], colors2: [0x4a2f1a, 0x2e1d12] },
        bottom: { type: 'long', colors: [0x4a3a2c, 0x3a3230] },
        shoes: [0x6e4a26, 0x54443a]
      },
      idle: 'talk', walkSpeed: 1.1
    },
    {
      id: 'warung', label: 'Pejalan — Pemilik warung', kind: 'ped',
      body: { waist: 1.08, belly: 0.35 }, heightRange: [1.58, 1.72], posture: { hunch: 0.18 },
      head: { jaw: 'taper' },
      face: { wrinkles: true, randomEyes: true },
      hair: { styles: ['bun', 'bob'] },
      wear: {
        top: { type: 'tee', colors: [0xc7b299, 0x9db38a, 0xd8cfc0] },
        bottom: { type: 'skirt', colors: [0x5a4632, 0x4a3a4a, 0x37452e] },
        shoes: [0x54443a, 0x6e4a26]
      },
      // ROUND 3: was 'idle_lean' — a lean with no wall/stall to lean on
      // reads as a broken hunched pose on a walking-route ped (this is
      // the frozen-looking figure in the user's chars-street report).
      idle: 'idle', walkSpeed: 0.9
    },
    {
      id: 'nelayan', label: 'Pejalan — Nelayan', kind: 'ped',
      body: { thigh: 1.02 }, heightRange: [1.64, 1.78],
      face: { randomEyes: true },
      hair: { style: 'cap', color: 0x24406e },
      wear: {
        top: { type: 'tee', colors: [0x5a86a8, 0x7a9a8a, 0xb8b0a0] },
        bottom: { type: 'shorts', colors: [0x3c4652, 0x4a4438] },
        shoes: [0x54443a, 0x3a3f45]
      },
      idle: 'idle', walkSpeed: 1.2
    },
    {
      id: 'ojek', label: 'Pejalan — Pengemudi ojek', kind: 'ped',
      body: {}, heightRange: [1.64, 1.78],
      face: { randomEyes: true },
      hair: { style: 'short' },
      wear: {
        top: { type: 'jacket', sleeve: 'long', colors: [0x2e7d32, 0x1f6e2e, 0x359846] },
        bottom: { type: 'long', colors: [0x2a2d33, 0x23242c] },
        shoes: [0x1c1e24, 0x22242a], hat: 'ojekhelmet', accessories: ['phone']
      },
      idle: 'idle_phone', walkSpeed: 1.3
    },
    {
      id: 'jogger', label: 'Pejalan — Jogger', kind: 'ped',
      body: { waist: 0.92 }, heightRange: [1.64, 1.82],
      face: { randomEyes: true },
      hair: { styles: ['ponytail', 'short', 'bob'] },
      wear: {
        top: { type: 'tee', colors: [0xd84a5a, 0x3aa8b8, 0xd8b13c, 0x6ab84a] },
        bottom: { type: 'shorts', colors: [0x23242c, 0x2c4a6e, 0x6e2a3a] },
        shoes: [0xf0ede6, 0xe84a6a, 0x3ac8d8]
      },
      idle: 'idle', walkSpeed: 2.6
    },
    {
      id: 'ibuBelanja', label: 'Pejalan — Ibu + tas belanja', kind: 'ped',
      body: { hips: 1.08 }, heightRange: [1.56, 1.68],
      head: { jaw: 'taper' },
      face: { randomEyes: true },
      hair: { styles: ['bob', 'bun', 'long'] },
      wear: {
        top: { type: 'blouse', colors: [0xc86a8a, 0x8a6ab8, 0x4a8a7a] },
        bottom: { type: 'skirt', colors: [0x4a3444, 0x37452e, 0x5a4632] },
        shoes: [0x3a2c22, 0x54443a], accessories: ['bag']
      },
      idle: 'idle', walkSpeed: 1.0
    },
    {
      id: 'kakek', label: 'Pejalan — Kakek bertongkat', kind: 'ped',
      body: { belly: 0.22, shoulder: 0.95 }, heightRange: [1.62, 1.72], posture: { hunch: 0.34 },
      face: { wrinkles: true, mouth: 'flat' },
      hair: { styles: ['bald', 'short'], color: 0xd8d3c8 },
      wear: {
        top: { type: 'tee', colors: [0x9a938a, 0x7a7f8a, 0x8a7a68] },
        bottom: { type: 'long', colors: [0x3a3a3c, 0x4a4038] },
        shoes: [0x2a2019, 0x1c1a16], accessories: ['cane']
      },
      idle: 'idle', gait: 'walk_old', walkSpeed: 0.7
    },
    {
      id: 'musisi', label: 'Pejalan — Musisi jalanan', kind: 'ped',
      body: {}, heightRange: [1.66, 1.80],
      face: { mouth: 'grin', randomEyes: true },
      hair: { styles: ['afro', 'quiff', 'long', 'messy'] },
      wear: {
        top: { type: 'tee', pattern: 'stripes', colors: [0xe8e3d8, 0xd84a3a, 0x3aa8b8], colors2: [0x2c4a7a, 0x2e7d32, 0x6e2a3a] },
        bottom: { type: 'long', colors: [0x2c2f36, 0x4a3a2c] },
        shoes: [0x54443a, 0x22242a], accessories: ['guitar']
      },
      idle: 'talk', walkSpeed: 1.1
    },
    {
      id: 'pekerjaDermaga', label: 'Pejalan — Pekerja dermaga (rompi oranye)', kind: 'ped',
      body: { shoulder: 1.06 }, heightRange: [1.68, 1.82],
      head: { jaw: 'square' },
      face: { randomEyes: true },
      hair: { styles: ['buzz', 'short'] },
      wear: {
        top: { type: 'vest', color: 0xe86a1c },
        bottom: { type: 'long', colors: [0x3c4652, 0x2f3844] },
        shoes: [0x1c1e24, 0x2a2019], hat: 'helmet', hatColor: 0xe86a1c
      },
      idle: 'idle', walkSpeed: 1.3
    },
    {
      id: 'pasangan', label: 'Pejalan — Pasangan', kind: 'ped',
      body: {}, heightRange: [1.62, 1.80],
      face: { randomEyes: true },
      hair: { styles: ['short', 'quiff', 'long', 'ponytail', 'bob'] },
      wear: {
        top: { type: 'blazer', sleeve: 'long', colors: [0xb8c8d8, 0xd8b8c8, 0xc8d8b8, 0x8a9ab8] },
        bottom: { type: 'long', colors: [0x3a3f4a, 0x4a4038, 0x2c2f36] },
        shoes: [0x3a2c22, 0x201a14]
      },
      idle: 'talk', walkSpeed: 1.2
    },
    {
      id: 'ibuHijab', label: 'Pejalan — Ibu berhijab', kind: 'ped',
      body: { hips: 1.06 }, heightRange: [1.56, 1.68],
      head: { jaw: 'taper' },
      face: { randomEyes: true },
      hair: { style: 'hijab', clothColors: [0x7a4a8a, 0x3a6a8a, 0xb85a7a, 0x4a7a5a, 0x8a6a3a] },
      wear: {
        top: { type: 'blouse', colors: [0xd8cfc0, 0xb8c8d8, 0xe3d3b8] },
        bottom: { type: 'skirt', colors: [0x4a3a52, 0x37424a, 0x5a4632] },
        shoes: [0x3a2c22, 0x54443a], accessories: ['bag']
      },
      idle: 'idle', walkSpeed: 1.0
    }
  ];

  var MAP = {};
  for (var i = 0; i < LIST.length; i++) MAP[LIST[i].id] = LIST[i];
  SH.Archetypes = MAP;
  SH.ArchetypeList = LIST;
})(window.SH = window.SH || {});
