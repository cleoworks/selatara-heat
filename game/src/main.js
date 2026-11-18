// SELATARA HEAT — main.js
// Boot, central game state, fixed-timestep loop, day/night lighting rig.
// Public API: SH.State (all mutable game state), SH.Main { scene, camera, renderer, setHour(h) }.
(function (SH) {
  'use strict';

  var State = {
    mode: 'loading', // loading | title | playing | paused | map
    time: 0, hour: SH.Config.day.startHour, weather: 'clear',
    camYaw: Math.PI, camPitch: 0.16,
    player: { x: SH.Config.world.spawn.x, z: SH.Config.world.spawn.z, y: 0, vx: 0, vz: 0, vy: 0, heading: 0, health: 100, armor: 0 },
    driving: false, vehicle: null, vehiclePos: { x: 0, y: 0, z: 0 },
    aiming: false, speedKmh: 0,
    cash: 250, wanted: 0, weapon: 'fist', ammo: 0, ammoReserve: 0,
    district: null, districtTimer: 0,
    objective: null, // { title, text, x, z }
    outfit: { shirt: 0xc94f4f, pants: 0x2a3550 },
    settings: { volume: 0.8, music: 0.6, sfx: 0.9, sensitivity: 1, quality: 'high' },
    stats: { missionsDone: 0, carsStolen: 0, distanceKm: 0 },
    paused: false
  };
  SH.State = State;

  var renderer, scene, camera, sun, hemi, skyMesh;
  var accumulator = 0, lastTs = 0;
  var tmpColorA = new THREE.Color(), tmpColorB = new THREE.Color();

  function lerpPalette(a, b, t, out) {
    var keys = ['skyTop', 'skyMid', 'skyLow', 'fog', 'sun', 'hemiSky', 'hemiGround', 'water', 'sand', 'asphalt', 'sidewalk', 'grass'];
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
    if (hour < 16.5) return lerpPalette(P.day, P.day, 0, currentPal);
    if (hour < 18.5) return lerpPalette(P.day, P.dusk, (hour - 16.5) / 2, currentPal);
    if (hour < 20) return lerpPalette(P.dusk, P.night, (hour - 18.5) / 1.5, currentPal);
    return lerpPalette(P.night, P.night, 0, currentPal);
  }

  function nightAmount(hour) {
    if (hour >= 19.5 || hour < 5) return 1;
    if (hour > 18) return (hour - 18) / 1.5;
    if (hour >= 5 && hour < 6.5) return 1 - (hour - 5) / 1.5;
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
    scene.fog.color.setHex(pal.fog);
    if (skyMesh) {
      drawSky(pal);
      skyMesh.position.set(focus.x, 0, focus.z);
    }
    SH.Roads.applyPalette(pal);
    SH.Buildings.setNightGlow(nightAmount(State.hour));
  }

  var skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  var skyTexture = new THREE.CanvasTexture(skyCanvas);
  var skyTick = 0;
  function drawSky(pal) {
    // Redrawing the gradient every frame is wasteful; refresh a few times a second.
    if ((skyTick++ & 15) !== 0 && skyTexture.image) return;
    var g = skyCanvas.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 256);
    tmpColorA.setHex(pal.skyTop); grad.addColorStop(0, '#' + tmpColorA.getHexString());
    tmpColorA.setHex(pal.skyMid); grad.addColorStop(0.55, '#' + tmpColorA.getHexString());
    tmpColorA.setHex(pal.skyLow); grad.addColorStop(1, '#' + tmpColorA.getHexString());
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    skyTexture.needsUpdate = true;
  }

  function buildWorld() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf7b98a, 180, 900);
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 1600);

    skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1300, 16, 12),
      new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    scene.add(skyMesh);

    hemi = new THREE.HemisphereLight(0xffe3c0, 0x5a4a44, 0.75);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffd9a8, 1.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);

    SH.Roads.build(scene);
    SH.Buildings.build(scene);
    SH.Player.build(scene);
    if (SH.Vehicles) SH.Vehicles.buildPool(scene);
    if (SH.Traffic) SH.Traffic.init(scene);
    if (SH.Pedestrians) SH.Pedestrians.init(scene);
    if (SH.Effects) SH.Effects.init(scene);
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
    State.aiming = input.aimDown && !State.driving;

    if (SH.Vehicles) SH.Vehicles.updateInteractions(dt);
    if (State.driving && SH.Vehicles) SH.Vehicles.updatePlayerVehicle(dt);
    else SH.Player.update(dt);
    if (SH.Traffic) SH.Traffic.update(dt);
    if (SH.Pedestrians) SH.Pedestrians.update(dt);
    SH.Roads.update(dt, State.time);
    SH.Player.updateCamera(dt, camera);
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
      else { // title/pause: still orbit the city slowly for the cinematic backdrop
        State.time += stepSize;
        SH.Roads.update(stepSize, State.time);
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
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    requestAnimationFrame(frame);
  }

  SH.Main = {
    setHour: function (h) { State.hour = h; },
    getScene: function () { return scene; },
    getCamera: function () { return camera; },
    boot: boot
  };

  window.addEventListener('DOMContentLoaded', boot);
})(window.SH = window.SH || {});
