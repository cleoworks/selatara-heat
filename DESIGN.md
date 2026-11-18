# SELATARA HEAT — Design Document

An original open-world crime game for make.fun bounty gta6-01 ("Make GTA 6").
Built as static files under `game/`, playable offline in desktop Chrome from
`file://`, keyboard + mouse. Every name, character, vehicle, brand, story,
texture, sound and piece of music in this game is original and procedural.

## 1. Setting

**Selatara** is a fictional strait port city on a tropical coast: a sun-soaked
harbour town of glass towers, shophouse rows, a night market, container cranes
and a hill of villas, wrapped by a ring highway and a ferry pier. Bilingual
street signs (Indonesian-flavoured, all invented), pastel neon, warm asphalt.
Nothing in Selatara copies any real place or any commercial game.

**Story.** Raka Pramudya, a former getaway driver fresh out of prison, owes an
old debt to the Arus Syndicate. Fixer Mami Ratna offers him a way out: eight
jobs, one per chapter, that pay the debt off piece by piece. Corrupt police
commissioner Varga takes a cut of everything and protects whoever pays most;
rival boss Dario "Kapten" Latu wants the strait for himself. The final job —
a chase to the last ferry out — decides whether Raka leaves Selatara free or
not at all. Finishing it rolls credits and unlocks free roam.

## 2. Districts (six, each with its own palette, heights and props)

| District | Identity | Buildings | Props |
|---|---|---|---|
| Pelita Heights | downtown skyline | tall glass towers, teal/cream | billboards, plaza palms |
| Pantai Kencana | beach + boardwalk | low pastel hotels/cafes | boardwalk, pier, beach umbrellas, waves |
| Pelabuhan Karat | industrial port | warehouses, rust tones | container stacks, cranes, fences |
| Ruko Senja | old town | 2-3 floor shophouses, terracotta/mint | night-market tents, bilingual signs, safehouse |
| Bukit Mawar | residential hills | villas, wide gardens | hedges, gates, parked sport cars |
| Taman Arus | central park + ring highway | almost none | trees, pond, benches, highway loop |

The road graph (intersections + lane edges) is one shared data set used by
traffic AI, police pathing (later slices) and the minimap renderer.

## 3. Palette (single source of truth: `game/src/config.js`)

- **Day / golden hour:** sky gradient peach `#ffb37a` → orange `#ff8c5a` →
  light blue `#7ec8e3`; buildings cream `#f2e3c6`, terracotta `#d97b5f`,
  mint `#9fd8c0`, teal `#3f9db5`; asphalt warm grey `#4a4442`; fog = horizon
  colour, never neutral grey.
- **Night:** sky navy `#0b1030` → purple `#2a1b4a`; neon pink `#ff4fa3`,
  cyan `#37e0ff`, yellow `#ffd23f` on signs; warm emissive windows
  `#ffca7a`; dark glossy asphalt `#23202b`; streetlight glow sprites.
- One consistent low-poly flat-shaded style (`flatShading: true`) everywhere.
- Lighting rig: HemisphereLight (warm sky / dark ground) + one
  DirectionalLight sun with a 2048 shadow map in a small camera box that
  follows the player; fog matched to the horizon; fake bloom via emissive
  materials + additive radial-gradient glow sprites + a CSS vignette overlay.
  No EffectComposer.

## 4. Missions (eight, data-driven state machine)

1. **First Run** — tutorial: pick up a package in Ruko Senja, deliver it to
   Pantai Kencana. Teaches driving, minimap, waypoint.
2. **Night Market Run** — on-foot chase: catch a courier through the market
   alleys of Ruko Senja before he reaches the pier.
3. **Port of Lies** — steal a container truck in Pelabuhan Karat and escape
   a 3-star wanted level to the drop-off warehouse.
4. **Escort Mami** — drive Mami Ratna across town while rival crews attack;
   keep her car alive (combat from/around the car).
5. **Hilltop Repo** — repossess a sport car from a Bukit Mawar villa and
   bring it to the workshop through police roadblocks.
6. **The Kencana Heist** — rob the boardwalk jewellery store, escape by boat
   from the pier to a hideout across the bay.
7. **Double Cross** — Varga's trap: survive a warehouse shootout in
   Pelabuhan Karat and escape.
8. **Last Ferry Out** — finale: chase Dario to the ferry pier, final
   confrontation, ending cutscene, credits, free roam unlock.

Each mission is a list of steps (`goTo`, `enterVehicle`, `chase`, `kill`,
`escape`, `deliver`, `follow`, `survive`, `timer`) with dialogue lines,
fail conditions, checkpoints and a cash reward.

## 5. Systems

- **On foot:** WASD + Shift sprint + Space jump, Pointer Lock mouse look,
  third-person over-shoulder camera with smoothing and collision pull-in,
  procedural limb-swing animation on a low-poly box character.
- **Vehicles:** arcade bicycle model (steering → speed-dependent yaw, lateral
  grip, handbrake drift, engine braking), four types — sedan, sport, truck,
  motorcycle — plus a mission boat. Enter/exit with F, carjacking, working
  head/tail/brake lights, damage with smoke and explosion at 0 HP, WebAudio
  engine sound whose pitch follows virtual RPM.
- **Traffic & pedestrians:** cars follow the road graph with car-following
  gaps, spawn out of sight, despawn far away, brake/honk/swerve near danger;
  pedestrians walk sidewalks, idle/chat, panic-flee from gunfire, ~45 cars
  and ~35 pedestrians pooled inside a radius around the player.
- **Wanted & police:** stars from crimes, SEARCHING with a shrinking search
  circle when line-of-sight is lost, PURSUIT with ramming and graph pathing,
  roadblocks from 3 stars, heavy units at 4, police helicopter with a
  spotlight cone at 4-5. Busted when boxed at low speed; wasted at 0 HP;
  both respawn with a cash fine.
- **Combat:** pistol, SMG, shotgun, melee — data-driven in `config.js`
  (damage, rate, spread, magazine, reload, recoil); hitscan with tracer,
  muzzle flash, impact sparks, hit marker, small screen shake; enemy AI with
  patrol/alert/cover/attack/flee states; health/armour/ammo/cash pickups.
- **Economy:** mission cash, gun shop, clothes shop (outfit colours),
  workshop (repair + paint), safehouse in Ruko Senja (save, outfit, 1-car
  garage). Shop interiors are menu overlays.
- **Save:** localStorage in try/catch, schema version, autosave after each
  mission and every 60 s, manual save at the safehouse, Continue on title.
- **Audio:** all WebAudio synthesis — engine, horn, siren (LFO oscillator),
  gunshots (filtered noise), explosion, footsteps, UI clicks, ambience
  (waves, night crickets), and two fictional radio stations playing synthetic
  bass/drum/arp loops. Context starts after the first user interaction.

## 6. HUD (DOM + CSS over the canvas, exact layout)

- **Round minimap**, bottom-left, ~190 px: static map (roads, blocks, water,
  park) pre-rendered once to a large offscreen canvas from the road graph;
  per frame it clips a circle, rotates with camera yaw, draws the player
  arrow centred, dynamic blips (red police, yellow mission, green
  shop/safehouse, blue target vehicle, white waypoint), edge-clamped blips,
  view cone, police search circle, dynamic zoom (wider when driving fast),
  and the district name fading in above it on district change.
- Bottom-left beside the minimap: health (red) and armour (blue) bars.
- Top-right: cash with count animation, game clock + weather icon, wanted
  stars (outline empty, solid active, flashing while searched).
- Bottom-right: weapon icon + ammo, or while driving a speedometer
  (big km/h number + arc gauge), vehicle damage and radio station name.
- Top-left: mission objective panel (title, active objective, distance) and
  a notification queue under it. Bottom-centre: dialogue subtitles.
  Floating 3D objective marker with distance. Crosshair only while aiming.
- Full map / pause: large square city map with legend, click-to-set
  waypoint, mission list and stats. Title screen is cinematic (slow orbiting
  camera over the city) with Continue / New Game / Settings / Controls;
  settings for volume, mouse sensitivity, graphics quality. Loading screen
  with progress. Debug FPS readout only behind F3, off by default.

## 7. Architecture (one file, one job — `game/src/`)

Classic scripts only (no ES modules, no fetch, no workers) loaded in order
into one global namespace `window.SH`, so the game runs from `file://`.
Three.js r159 classic build is vendored at `game/vendor/three.min.js`.

`config.js` (palette + all tuning) · `input.js` (keys, mouse, pointer lock) ·
`audio.js` (synth SFX + radio) · `world.js` (seeded PRNG, districts, road
graph) · `roads.js` (road/sidewalk meshes, streetlights) · `buildings.js`
(instanced buildings, canvas facades, props) · `vehicles.js` (car factory +
arcade physics) · `traffic.js` (traffic AI pool) · `pedestrians.js` (ped
pool + panic) · `player.js` (on-foot controller + camera) · `police.js`
(wanted state machine + pursuit) · `combat.js` (weapons, hitscan, enemy AI) ·
`missions.js` (mission runner + the 8 missions) · `economy.js` (money,
shops, safehouse) · `hud.js` (HUD DOM) · `minimap.js` (round minimap +
full map) · `menus.js` (title/pause/settings/controls/loading) ·
`save.js` (localStorage) · `effects.js` (pooled particles, trauma shake) ·
`shots.js` (deterministic `?shot=` scenes for screenshots) · `main.js`
(fixed-timestep loop, state machine, day cycle, lighting rig).

Performance rules: fixed 1/60 physics timestep with an accumulator (max 5
steps), no allocations in hot loops (reused temp vectors), object pools for
bullets/particles/cars/peds, spatial-hash collision (building AABBs, vehicle
circle pairs, player circle), instanced meshes for buildings/lamps/palms,
chunked activation by distance. Target: stable ~60 FPS on an ordinary laptop.

## 8. Build order (vertical slices, playable at every step)

(a) engine + loop + procedural city + on-foot camera — **this run**
(b) vehicles + traffic + pedestrians — **this run**
(c) HUD + round minimap + menus — **this run**
(d) wanted/police · (e) combat · (f) missions 1-4 + save → first full pass
(g) missions 5-8, economy, audio/radio, weather · (h) polish + screenshots

After every slice: headless Chromium check from `file://` (zero console
errors), a screenshot is eyeballed, bugs fixed before moving on, then a
commit + push. Scope cuts, in order, if time runs short: player helicopter,
free-roam boat, dynamic rain, shop interiors. Never cut: round minimap, HUD,
wanted/police, save/load, all 8 missions end-to-end, zero console errors.

## 9. Risks

- `file://` + classic scripts is the hard constraint: no module loading, so
  script order in `index.html` is load-bearing and guarded by a boot check.
- Screenshot caps (≤256 KiB, ≤1280 px long side) mean final shots are staged
  through `shots.js` at golden hour / night chase set-ups, then downscaled.
- Three.js must stay the minified vendored build so its lines never count
  against authorship; all game code is written by hand in this repo.
