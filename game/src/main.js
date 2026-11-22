// SELATARA HEAT — main.js
// Boot, central game state, fixed-timestep loop, day/night lighting rig.
// Public API: SH.State (all mutable game state), SH.Main { scene, camera, renderer, setHour(h) }.
(function (SH) {
  'use strict';

  var State = {
    mode: 'loading', // loading | title | playing | paused | map
    time: 0, hour: SH.Config.day.startHour, weather: 'clear',
    camYaw: Math.PI, camPitch: 0.19, // 0.19 rad ~ 10.9 deg: the on-foot default pitch (FX camera reset, spec 10-12 deg)
    player: { x: SH.Config.world.spawn.x, z: SH.Config.world.spawn.z, y: 0, vx: 0, vz: 0, vy: 0, heading: 0, health: 100, armor: 0 },
    driving: false, vehicle: null, vehiclePos: { x: 0, y: 0, z: 0 },
    aiming: false, speedKmh: 0,
    cash: 250, wanted: 0, weapon: 'fist', ammo: 0, ammoReserve: 0,
    radioStation: 'RADIO SELATARA FM', stun: 0, _dmgFlash: 0, cutscene: false,
    shopOpen: false, shopKind: null, storyComplete: false,
    district: null, districtTimer: 0,
    objective: null, // { title, text, x, z }
    outfit: { shirt: 0xc94f4f, pants: 0x2a3550 },
    settings: { volume: 0.8, music: 0.6, sfx: 0.9, sensitivity: 1, quality: 'high' },
    stats: { missionsDone: 0, carsStolen: 0, distanceKm: 0 },
    paused: false
  };
  SH.State = State;

  var renderer, scene, camera, sun, hemi, skyMesh, ambLight, fillLight, rimLight, charRim, charKey;
  var accumulator = 0, lastTs = 0;
  var tmpColorA = new THREE.Color(), tmpColorB = new THREE.Color();

  function lerpPalette(a, b, t, out) {
    var keys = ['skyTop', 'skyBand', 'skyMid', 'skyLow', 'fog', 'sun', 'hemiSky', 'hemiGround', 'water', 'sand', 'asphalt', 'sidewalk', 'grass'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      tmpColorA.setHex(a[k]); tmpColorB.setHex(b[k]);
      tmpColorA.lerp(tmpColorB, t);
      out[k] = tmpColorA.getHex();
    }
    out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
    out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
    out.ambient = a.ambient + (b.ambient - a.ambient) * t;
    return out;
  }

  var currentPal = {};
  function paletteAt(hour) {
    var P = SH.Config.palette;
    if (hour < 5.5) return lerpPalette(P.night, P.night, 0, currentPal);
    if (hour < 7) return lerpPalette(P.night, P.day, (hour - 5.5) / 1.5, currentPal);
    if (hour < 15.5) return lerpPalette(P.day, P.day, 0, currentPal);
    if (hour < 17.4) return lerpPalette(P.day, P.dusk, (hour - 15.5) / 1.9, currentPal);
    if (hour < 18.6) return lerpPalette(P.dusk, P.dusk, 0, currentPal);
    if (hour < 20) return lerpPalette(P.dusk, P.night, (hour - 18.6) / 1.4, currentPal);
    return lerpPalette(P.night, P.night, 0, currentPal);
  }

  function nightAmount(hour) {
    if (hour >= 19.5 || hour < 5) return 1;
    if (hour > 18) return (hour - 18) / 1.5;
    if (hour >= 5 && hour < 6.5) return 1 - (hour - 5) / 1.5;
    return 0;
  }

  // Streetlights and glow effects come on from golden hour, not just at night.
  function lampAmount(hour) {
    if (hour >= 18.4 || hour < 5.2) return 1;
    if (hour > 16.6) return (hour - 16.6) / 1.8;
    if (hour >= 5.2 && hour < 6.8) return 1 - (hour - 5.2) / 1.6;
    return 0;
  }

  function applyLighting() {
    var pal = paletteAt(State.hour);
    var sunAngle = ((State.hour - 6) / 12) * Math.PI; // sunrise 6h, sunset 18h
    var elev = Math.sin(sunAngle);
    var focus = State.driving ? State.vehiclePos : State.player;
    sun.position.set(focus.x + Math.cos(sunAngle) * 120, Math.max(18, elev * 160), focus.z + 60);
    sun.target.position.set(focus.x, 0, focus.z);
    sun.target.updateMatrixWorld();
    sun.intensity = pal.sunIntensity;
    sun.color.setHex(pal.sun);
    hemi.intensity = pal.hemiIntensity;
    hemi.color.setHex(pal.hemiSky);
    hemi.groundColor.setHex(pal.hemiGround);
    if (ambLight) { ambLight.intensity = pal.ambient; ambLight.color.setHex(pal.hemiSky); }
    if (scene.fog) {
      scene.fog.color.setHex(pal.fog);
      // Aerial legibility (Rev 11): the ground-tuned fog range
      // (150/1050 m) swallows the whole city from any high camera —
      // the pale "haze" in aerial shots. (It also survived fog=null
      // attempts because this line crashed on the null every frame.)
      // The range now lifts smoothly with camera altitude; at
      // gameplay heights (<= ~10 m) it is exactly as tuned.
      var altLift = Math.min(1, Math.max(0, (camera.position.y - 10) / 290));
      scene.fog.near = 150 + altLift * 550;
      scene.fog.far = 1050 + altLift * 1950;
    }
    if (skyMesh) {
      drawSky(pal);
      skyMesh.position.set(focus.x, 0, focus.z);
    }
    SH.Roads.applyPalette(pal, nightAmount(State.hour));
    // Environment reflections refresh only when the light PHASE
    // changes (Step 5) — a PMREM build is far too heavy for per-frame.
    var pk = phaseKey(State.hour);
    if (pk !== envPhase) { envPhase = pk; buildEnvironment(pal); }
    var lamp = lampAmount(State.hour);
    SH.Buildings.setNightGlow(Math.max(lamp, nightAmount(State.hour) * 0.9));
    // Night exposure + the player fill light ride the same curve: the
    // renderer opens up a little after dark and the fill hovers over the
    // focus, offset toward the camera so it rims the subject.
    // OVERHAUL: exposure breathes with the light phase — a
    // golden-hour lift (+0.07 at the horizon sun of the cover)
    // on top of the base, keeping the night ramp. Flat 1.15 at
    // every hour was one of the "flat light" tells: the dusk
    // frame and the noon frame exposed identically.
    var goldAmt = Math.max(0, 1 - Math.abs(elev) * 3.2) * (1 - nightAmount(State.hour));
    if (renderer) renderer.toneMappingExposure = 1.15 + goldAmt * 0.07 + nightAmount(State.hour) * 0.22;
    if (fillLight) {
      var fAmt = nightAmount(State.hour);
      // FX fix: three r155+ physical light units make a PointLight's
      // intensity DIVIDE by distance^decay — the old 1.5 reached the
      // focus (~3.5 m away, decay 1.8) as ~0.15, i.e. effectively no
      // fill at all, and night clothes fell to black. 16 lands as
      // ~1.7 at the subject: a real soft frontal fill after dark.
      fillLight.intensity = fAmt * 16;
      if (fAmt > 0.01) {
        fillLight.position.set(
          focus.x + Math.sin(State.camYaw) * 3.5,
          3.4,
          focus.z + Math.cos(State.camYaw) * 3.5
        );
      }
    }
    if (rimLight) {
      // Scale with the key: full cool rim by day, a quarter-strength
      // moon/city rim after dark (v4 band 1.2-2.0 against a 2.5-3 key
      // maps to ~1.15 against this scene's tuned 1.35 day key).
      rimLight.intensity = 1.15 * Math.min(1, Math.max(0.22, pal.sunIntensity / 1.35));
      rimLight.position.set(focus.x - Math.sin(State.camYaw) * 55, 34, focus.z - Math.cos(State.camYaw) * 55);
      rimLight.target.position.set(focus.x, 1.2, focus.z);
      rimLight.target.updateMatrixWorld();
    }
    if (charRim) {
      // STAGE E: the character style's WARM rim (STYLE.md — the same
      // 0xffc890 the lab uses), parked behind the focus against the
      // camera so people keep a warm edge. It matters most after
      // dark (ap2: leads must separate from dark ground at night),
      // so its floor RISES with the night amount instead of falling.
      var nAmt = nightAmount(State.hour);
      charRim.intensity = 0.85 + nAmt * 0.65;
      charRim.position.set(
        focus.x - Math.sin(State.camYaw) * 30,
        9,
        focus.z - Math.cos(State.camYaw) * 30
      );
      charRim.target.position.set(focus.x, 1.1, focus.z);
      charRim.target.updateMatrixWorld();
    }
    if (SH.CharFactory && SH.CharFactory.setRimLevel) {
      // RONDE 3B: the leads' rim SHELL is a NIGHT separator (ap2) —
      // it has no job in daylight, but at its constant full strength
      // its additive fresnel climbed the loft's ring steps and read
      // as a dotted bright line around the silhouette at the default
      // camera (parent zoom proof, fx3-game-day). Shell strength now
      // rides the same night curve as the rim light: the full
      // approved 1.25 after dark. Shells are LOD0-only, so no
      // distance fade is needed — the defective distance IS the
      // default camera distance.
      // RONDE 3C: the 3B day floor of 0.05 still leaked a residue —
      // isolation renders (rim shells hidden = level 0 exactly)
      // proved the shell alone contributes 346 warm-shifted pixels
      // (delta lum > 6) on the silhouette chains of the day staging,
      // 235 of them on the legs: the scattered warm dots the user
      // still saw at 5x zoom. envMapIntensity was A/B'd and cleared
      // (broad whole-body wash, no dot pattern; 0 would also flatten
      // the FX2 gradation), and the dark outline hull cannot emit
      // bright dots. Day floor is now a true 0.0; the night end of
      // the curve is unchanged (0 + 1.0 * 1.25 = the approved 1.25)
      // and dusk still ramps smoothly with nightAmount.
      SH.CharFactory.setRimLevel(nightAmount(State.hour) * 1.25);
    }
    if (charKey) {
      // FX2 character key: ~1.5 at the subject by day (the lab key
      // is 1.6), ~0.95 after dark, always front-top-side of the
      // camera, so the toon ramp shows its steps across the body
      // instead of one flat fill. The 18 m throw keeps the pool
      // local — the wider world grade is untouched.
      var kAmt = nightAmount(State.hour);
      charKey.intensity = 26 - kAmt * 10;
      charKey.position.set(
        focus.x + Math.sin(State.camYaw) * 3.2 + Math.cos(State.camYaw) * 2.6,
        3.6,
        focus.z + Math.cos(State.camYaw) * 3.2 - Math.sin(State.camYaw) * 2.6
      );
    }
    if (SH.Vehicles && SH.Vehicles.setLightLevel) SH.Vehicles.setLightLevel(lamp);
    updateSunSprite(pal, elev, sunAngle);
    updateClouds(pal, SH.Config.loop.step);
    // Wet-sheen roads at golden hour: the lower the sun, the glossier the
    // asphalt (fake wet-street reflection, strongest looking into the sun).
    var sheen = 12 + Math.max(0, 1 - Math.abs(elev) * 2.2) * 34 * (1 - nightAmount(State.hour)) + lamp * 8;
    if (SH.Roads) SH.Roads.baseShininess = sheen;
  }

  // ---- Procedural environment reflections (Step 5) ----
  // A tiny gradient-sky scene with an HDR-bright sun ball, rendered
  // through PMREM once per light phase and installed as
  // scene.environment. Without it, metalness has nothing to reflect
  // and car paint reads as coloured plastic.
  var envRT = null, envPhase = '';
  function phaseKey(hour) {
    if (hour < 5.5) return 'night';
    if (hour < 7) return 'dawn';
    if (hour < 15.5) return 'day';
    if (hour < 18.6) return 'golden';
    if (hour < 20) return 'duskfall';
    return 'night';
  }
  function buildEnvironment(pal) {
    if (!renderer || !scene) return;
    var es = new THREE.Scene();
    var geo = new THREE.SphereGeometry(60, 16, 12);
    var posA = geo.attributes.position;
    var cols = new Float32Array(posA.count * 3);
    var top = new THREE.Color(pal.hemiSky), hor = new THREE.Color(pal.fog), gnd = new THREE.Color(pal.hemiGround);
    var cc = new THREE.Color();
    for (var i = 0; i < posA.count; i++) {
      var ny = posA.getY(i) / 60;
      if (ny >= 0) cc.copy(hor).lerp(top, Math.pow(ny, 0.6));
      else cc.copy(hor).lerp(gnd, Math.min(1, -ny * 2));
      cols[i * 3] = cc.r; cols[i * 3 + 1] = cc.g; cols[i * 3 + 2] = cc.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    es.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false })));
    var sunMat = new THREE.MeshBasicMaterial({ fog: false });
    sunMat.color.setRGB(5, 4.4, 3.4);
    var sunBall = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), sunMat);
    var sa = ((State.hour - 6) / 12) * Math.PI;
    sunBall.position.set(Math.cos(sa) * 45, Math.max(6, Math.sin(sa) * 38), 20);
    es.add(sunBall);
    var pm = new THREE.PMREMGenerator(renderer);
    var rt = pm.fromScene(es, 0.04);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    if (SH.Buildings && SH.Buildings.setEnvMap) SH.Buildings.setEnvMap(rt.texture);
    pm.dispose();
  }

  // Big soft sun glow on the horizon (fake bloom): a radial-gradient sprite
  // that sits in the sun's direction, strongest at golden hour.
  var sunSprite = null, sunCore = null;
  function makeGlowSprite(inner, outer) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, inner); grad.addColorStop(0.35, outer); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    return sp;
  }
  function updateSunSprite(pal, elev, sunAngle) {
    if (!sunSprite) {
      // Natural-sky revision: the sun is a DISC + a thin halo, not an
      // 820 m wash — the old sprites blew the whole frame white at
      // golden hour (the market-corridor blow-out in the combat shot).
      sunSprite = makeGlowSprite('rgba(255,230,180,0.95)', 'rgba(255,130,50,0.55)');
      sunSprite.scale.set(340, 340, 1);
      scene.add(sunSprite);
      sunCore = makeGlowSprite('rgba(255,255,240,1)', 'rgba(255,180,90,0.6)');
      sunCore.scale.set(80, 80, 1);
      scene.add(sunCore);
    }
    var focus = State.driving ? State.vehiclePos : State.player;
    var dirx = Math.cos(sunAngle), dirz = 0.42;
    var dist = 1150;
    var y = Math.max(30, elev * 620);
    sunSprite.position.set(focus.x + dirx * dist, y, focus.z + dirz * dist);
    sunCore.position.copy(sunSprite.position);
    var dayness = 1 - nightAmount(State.hour);
    var glow = dayness * (0.35 + 0.65 * Math.max(0, 1 - Math.abs(elev) * 2.4));
    // Below the horizon the disc is GONE — only a fading afterglow may
    // remain. Without this the sprites burned a white column into the
    // 19:15 combat staging (elev there is -0.31) long after sunset.
    glow *= Math.max(0, Math.min(1, elev * 2.6 + 0.35));
    // Low-sun discipline (parent note on the 18:22 combat staging):
    // between 18:00 and 18:45 the sun sits just over the horizon and
    // the full-size disc + halo stack still blew the corridor end
    // white. As elevation drops toward the horizon the halo shrinks
    // (340 -> 190 m), the core tightens (80 -> 52 m) and both caps
    // fade, leaving a readable warm disc; midday is untouched.
    var lowSun = Math.max(0, Math.min(1, 1 - Math.max(0, elev) / 0.35));
    sunSprite.scale.set(340 - 150 * lowSun, 340 - 150 * lowSun, 1);
    sunCore.scale.set(80 - 28 * lowSun, 80 - 28 * lowSun, 1);
    sunSprite.material.opacity = glow * (0.5 - 0.28 * lowSun);
    sunCore.material.opacity = glow * (0.8 - 0.3 * lowSun);
    sunSprite.visible = sunCore.visible = glow > 0.02;
  }

  var skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  var skyTexture = new THREE.CanvasTexture(skyCanvas);
  if (THREE.sRGBEncoding) skyTexture.encoding = THREE.sRGBEncoding;
  var skyTick = 0;
  function drawSky(pal) {
    // Redrawing the gradient every frame is wasteful; refresh a few times a second.
    if ((skyTick++ & 15) !== 0 && skyTexture.image) return;
    var g = skyCanvas.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 256);
    tmpColorA.setHex(pal.skyTop); grad.addColorStop(0, '#' + tmpColorA.getHexString());
    tmpColorA.setHex(pal.skyBand); grad.addColorStop(0.38, '#' + tmpColorA.getHexString());
    tmpColorA.setHex(pal.skyMid); grad.addColorStop(0.66, '#' + tmpColorA.getHexString());
    tmpColorA.setHex(pal.skyLow); grad.addColorStop(1, '#' + tmpColorA.getHexString());
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    skyTexture.needsUpdate = true;
  }

  // Procedural thin clouds: soft elongated sprites parked high on the sky
  // dome so the sky is never a bare gradient. One shared texture + material;
  // the whole group follows the camera focus like the sky dome does, drifts
  // slowly, and is tinted by the palette (white day, pink dusk, slate night).
  var cloudGroup = null, cloudMat = null;
  function buildClouds() {
    var c = document.createElement('canvas'); c.width = 256; c.height = 64;
    var g = c.getContext('2d');
    var blobs = [[70, 36, 44], [120, 30, 56], [176, 38, 42], [100, 42, 34], [150, 44, 30]];
    for (var i = 0; i < blobs.length; i++) {
      var gr = g.createRadialGradient(blobs[i][0], blobs[i][1], 2, blobs[i][0], blobs[i][1], blobs[i][2]);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 256, 64);
    }
    var tex = new THREE.CanvasTexture(c);
    cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    cloudGroup = new THREE.Group();
    var rng = SH.World.makeRng(1234);
    for (var k = 0; k < 16; k++) {
      var sp = new THREE.Sprite(cloudMat);
      var ang = rng() * Math.PI * 2, dist = 620 + rng() * 420;
      sp.position.set(Math.cos(ang) * dist, 130 + rng() * 190, Math.sin(ang) * dist);
      sp.scale.set(300 + rng() * 320, 52 + rng() * 46, 1);
      sp.userData.drift = 1.2 + rng() * 2.2;
      cloudGroup.add(sp);
    }
    scene.add(cloudGroup);
  }
  function updateClouds(pal, dt) {
    if (!cloudGroup) buildClouds();
    var focus = State.driving ? State.vehiclePos : State.player;
    cloudGroup.position.set(focus.x, 0, focus.z);
    cloudMat.color.setHex(pal.skyLow);
    // Clouds are a ground-up sky feature: from a high camera they sit
    // BETWEEN the lens and the city as white veils (they ignore scene
    // fog), so their opacity fades out with camera altitude (Rev 11).
    var cloudAlt = 1 - Math.min(1, Math.max(0, (camera.position.y - 120) / 180));
    cloudMat.opacity = (0.28 + 0.5 * (1 - nightAmount(State.hour))) * cloudAlt;
    for (var i = 0; i < cloudGroup.children.length; i++) {
      var sp = cloudGroup.children[i];
      sp.position.x += sp.userData.drift * dt;
      if (sp.position.x > 1150) sp.position.x = -1150;
    }
  }

  function buildWorld() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf7b98a, 150, 1050);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 1600);

    skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1300, 16, 12),
      new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    scene.add(skyMesh);

    hemi = new THREE.HemisphereLight(0xffe3c0, 0x5a4a44, 0.75);
    scene.add(hemi);
    ambLight = new THREE.AmbientLight(0xffe3c0, 0.35);
    scene.add(ambLight);
    sun = new THREE.DirectionalLight(0xffd9a8, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -115; sun.shadow.camera.right = 115;
    sun.shadow.camera.top = 115; sun.shadow.camera.bottom = -115;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0006;
    // FX3 artifact pass: normalBias offsets the shadow sample along
    // the surface normal (2 cm) — the standard guard against
    // self-shadowing acne on curved cloth/skin at grazing sun
    // angles. A/B at the character close-up stagings (bias -0.001 /
    // normalBias 0.02, toggled at runtime) moved <=0.005% of pixels:
    // no acne was present to remove and no contact shadow lifted
    // (no peter-panning), so the shipped bias stays at its proven
    // -0.0006 and normalBias is installed as hygiene per spec.
    sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);

    // Player fill light (Art Pass 3): one warm point light that hovers
    // above and behind the camera focus after dark, so faces, clothes
    // and car paint near the player keep a readable rim instead of
    // falling to black. Intensity is driven by applyLighting (0 by day).
    fillLight = new THREE.PointLight(0xffd9b0, 0, 26, 1.8);
    scene.add(fillLight);

    // Cool rim light (Character Smoothness Pass, ART-BIBLE v4): one
    // shadowless directional parked behind the camera focus, so
    // figures and car shoulders keep a cold edge against the warm
    // key instead of melting into the background. Intensity and
    // position are driven by applyLighting.
    rimLight = new THREE.DirectionalLight(0x9fc0ff, 0);
    scene.add(rimLight); scene.add(rimLight.target);

    // Warm character rim (Stage E): one shadowless directional in
    // the character style's warm tone; intensity/position are driven
    // by applyLighting. The leads additionally carry the factory's
    // own fresnel rim shells.
    charRim = new THREE.DirectionalLight(0xffc890, 0);
    scene.add(charRim); scene.add(charRim.target);

    // Character key (FX2): one warm point light parked front-top-side
    // of the camera focus — the lab's key-light recipe (0xfff1dd)
    // carried into the game. After the round-1 grade fix, a figure's
    // front was lit almost only by the directionless hemisphere +
    // ambient wash, so the toon ramp collapsed to a single chalky
    // step (the "crayon" read). A short-throw point light models the
    // body the way the lab key does, without touching the world:
    // intensity/position are driven by applyLighting.
    charKey = new THREE.PointLight(0xfff1dd, 0, 18, 1.8);
    scene.add(charKey);

    SH.Roads.build(scene);
    SH.Buildings.build(scene);
    if (SH.Landmarks) SH.Landmarks.build(scene);
    SH.Player.build(scene);
    if (SH.Vehicles) SH.Vehicles.buildPool(scene);
    if (SH.Traffic) SH.Traffic.init(scene);
    if (SH.Pedestrians) SH.Pedestrians.init(scene);
    if (SH.Effects) SH.Effects.init(scene);
    if (SH.Weather) SH.Weather.init(scene);
    applyLighting();
  }

  function step(dt) {
    State.time += dt;
    State.hour = (State.hour + dt * SH.Config.day.minutesPerSecond / 60) % 24;

    var input = SH.Input;
    if (State.mode === 'playing' && input.locked) {
      State.camYaw -= input.mouseDX * 0.0026;
      State.camPitch += input.mouseDY * 0.0022;
      State.camPitch = Math.max(-0.5, Math.min(1.0, State.camPitch));
    }
    State.aiming = (input.aimDown || State._shotAim) && !State.driving;
    if (State.stun > 0) State.stun -= dt;
    if (State._dmgFlash > 0) State._dmgFlash = Math.max(0, State._dmgFlash - dt * 1.4);
    var frozen = State.stun > 0;

    if (!frozen && SH.Vehicles) SH.Vehicles.updateInteractions(dt);
    if (State.driving && SH.Vehicles) { if (!frozen) SH.Vehicles.updatePlayerVehicle(dt); }
    else if (!frozen) SH.Player.update(dt);
    else if (SH.Player.mesh) SH.Player.mesh.visible = !State.driving;
    if (SH.Traffic) SH.Traffic.update(dt);
    if (SH.Pedestrians) SH.Pedestrians.update(dt);
    if (SH.Vehicles && SH.Vehicles.updateVisuals) SH.Vehicles.updateVisuals();
    if (SH.Police) SH.Police.update(dt);
    if (SH.Combat) SH.Combat.update(dt);
    if (SH.Missions) SH.Missions.update(dt);
    if (SH.Economy) SH.Economy.update(dt);
    if (SH.Weather) SH.Weather.update(dt);
    if (input.wasPressed('KeyQ') && SH.Combat) SH.Combat.cycleWeapon();
    if (input.wasPressed('KeyK') && SH.Audio && SH.Audio.ctx) {
      State.radioStation = SH.Audio.cycleStation();
      if (SH.HUD) SH.HUD.notify('Radio — ' + State.radioStation);
    }
    State._autosave = (State._autosave || 0) + dt;
    if (State._autosave > 60) { State._autosave = 0; if (SH.Save) SH.Save.saveGame(); }
    SH.Roads.update(dt, State.time);
    if (SH.Landmarks) SH.Landmarks.update(dt);
    SH.Player.updateCamera(dt, camera);
    if (SH.Vehicles && SH.Vehicles.updateLOD) SH.Vehicles.updateLOD(camera.position);
    if (SH.Effects) SH.Effects.update(dt, camera);
    applyLighting();

    var focus = State.driving ? State.vehiclePos : State.player;
    var d = SH.World.districtAt(focus.x, focus.z);
    if (d !== State.district) {
      State.district = d;
      State.districtTimer = 3.2;
      if (SH.HUD && d) SH.HUD.showDistrict(d.name);
    } else if (State.districtTimer > 0) State.districtTimer -= dt;

    if (SH.Minimap && State.mode !== 'loading') SH.Minimap.render();
    if (SH.HUD) SH.HUD.refresh();
    input.endFrame();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dtMs = Math.min(250, ts - lastTs);
    lastTs = ts;
    accumulator += dtMs / 1000;
    var stepSize = SH.Config.loop.step;
    var n = 0;
    while (accumulator >= stepSize && n < SH.Config.loop.maxSteps) {
      if (State.mode === 'playing') step(stepSize);
      else if (State.mode === 'cutscene') {
        // Intro cutscene: the world lives, the camera follows the shot list.
        State.time += stepSize;
        State.hour = (State.hour + stepSize * SH.Config.day.minutesPerSecond / 60) % 24;
        if (SH.Traffic) SH.Traffic.update(stepSize);
        if (SH.Pedestrians) SH.Pedestrians.update(stepSize);
        if (SH.Effects) SH.Effects.update(stepSize, camera);
        SH.Roads.update(stepSize, State.time);
        if (SH.Landmarks) SH.Landmarks.update(stepSize);
        applyLighting();
        if (SH.Missions) SH.Missions.updateCutscene(stepSize, camera);
        if (SH.HUD) SH.HUD.refresh();
        SH.Input.endFrame();
      }
      else { // title/pause: still orbit the city slowly for the cinematic backdrop
        State.time += stepSize;
        SH.Roads.update(stepSize, State.time);
        if (SH.Landmarks) SH.Landmarks.update(stepSize);
        applyLighting();
        SH.Input.endFrame();
      }
      accumulator -= stepSize;
      n++;
    }
    if (n === SH.Config.loop.maxSteps) accumulator = 0;
    if (State.mode === 'title' && SH.Menus) SH.Menus.updateTitleCamera(camera);
    renderer.render(scene, camera);
  }

  function boot() {
    var canvas = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    // Saturated filmic grade: sRGB output + ACES curve lifts the flat
    // Lambert colours toward the saturated reference look.
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    // FX fix: NO CSS grade on the canvas anymore. The old
    // contrast(1.08) saturate(1.15) filter existed only in the game
    // (the lab has none) and was a root cause of the character
    // regression: oversaturated orange skin, clothes crushed to
    // black, face shading reading coarse. Character materials also
    // opt out of tone mapping individually (factory charGrade), so
    // people now render through the same pipeline as the lab.
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    // OVERHAUL: PCFSoft — the hard PCF edge made the long dusk
    // shadows read as aliased steps on the asphalt; soft filtering
    // is the same shadow map, just filtered like light.
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    buildWorld();
    SH.Input.init(canvas);
    if (SH.Minimap) SH.Minimap.init();
    if (SH.HUD) SH.HUD.init();
    if (SH.Menus) SH.Menus.init();
    if (SH.Shots) SH.Shots.apply();
    if (State.mode === 'loading') State.mode = (SH.Shots && SH.Shots.active) || !SH.Menus ? 'playing' : 'title';
    if (!SH.Menus) { var lo = document.getElementById('loading'); if (lo) lo.classList.add('hidden'); }
    if (SH.Menus) SH.Menus.syncMode();
    // Pre-compile every shader program NOW, inside boot: the physical
    // character materials (sheen/clearcoat/wrap variants) take seconds
    // to compile on software GL, and if that cost lands on the first
    // live frame it stalls the main thread long enough to swallow the
    // title screen's first click. Inside boot it is just load time.
    try { renderer.compile(scene, camera); } catch (e) { /* non-fatal */ }
    requestAnimationFrame(frame);
  }

  SH.Main = {
    applyQuality: function (q) {
      if (!renderer || !sun) return;
      if (q === 'low') { sun.castShadow = false; renderer.setPixelRatio(1); }
      else if (q === 'medium') { sun.castShadow = true; renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); }
      else { sun.castShadow = true; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); }
    },
    setHour: function (h) { State.hour = h; },
    getScene: function () { return scene; },
    getCamera: function () { return camera; },
    getRenderer: function () { return renderer; }, // perf audits (draw calls)
    boot: boot
  };

  window.addEventListener('DOMContentLoaded', boot);
})(window.SH = window.SH || {});
