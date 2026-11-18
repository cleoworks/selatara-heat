// SELATARA HEAT — effects.js
// Pooled particles (smoke, sparks, explosion, dust) on one THREE.Points cloud,
// plus trauma-based screen shake applied to the camera after it is positioned.
// Public API: SH.Effects { init(scene), update(dt, camera), burst(x,y,z,opts), smoke(x,y,z), shake(amount) }.
(function (SH) {
  'use strict';

  var MAX = 420;
  var pool = [];
  var points = null, posAttr = null, colAttr = null;
  var trauma = 0;

  var Effects = {
    init: function (scene) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
      for (var i = 0; i < MAX; i++) {
        pool.push({ life: 0, maxLife: 1, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, grow: 0, r: 1, g: 1, b: 1, drag: 1 });
        pos[i * 3 + 1] = -50;
      }
      posAttr = new THREE.BufferAttribute(pos, 3);
      colAttr = new THREE.BufferAttribute(col, 3);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('color', colAttr);
      points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
      points.frustumCulled = false;
      scene.add(points);
    },

    spawn: function (x, y, z, vx, vy, vz, life, r, g, b) {
      for (var i = 0; i < MAX; i++) {
        var p = pool[i];
        if (p.life <= 0) {
          p.life = life; p.maxLife = life;
          p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
          p.r = r; p.g = g; p.b = b;
          return;
        }
      }
    },

    burst: function (x, y, z, opts) {
      opts = opts || {};
      var n = opts.count || 14, spd = opts.speed || 6;
      var c = opts.color || [1, 0.6, 0.2];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 0.4;
        this.spawn(x, y, z,
          Math.cos(a) * spd * Math.random(), e * spd * 0.6 + 2, Math.sin(a) * spd * Math.random(),
          0.5 + Math.random() * (opts.life || 0.8), c[0], c[1], c[2]);
      }
    },

    // A tracer: a short chain of fast, short-lived bright particles along a line.
    tracer: function (x1, y1, z1, x2, y2, z2, hostile) {
      var steps = 5;
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        this.spawn(
          x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t,
          (x2 - x1) * 2.2, (y2 - y1) * 2.2, (z2 - z1) * 2.2,
          0.09, hostile ? 1 : 1, hostile ? 0.3 : 0.85, hostile ? 0.25 : 0.4);
      }
    },

    muzzle: function (x, y, z) {
      this.burst(x, y, z, { count: 3, speed: 1.6, life: 0.12, color: [1, 0.75, 0.3] });
    },

    sparks: function (x, y, z) {
      this.burst(x, y, z, { count: 7, speed: 4.5, life: 0.35, color: [1, 0.7, 0.25] });
    },

    blood: function (x, y, z) {
      this.burst(x, y, z, { count: 6, speed: 2.6, life: 0.4, color: [0.62, 0.08, 0.1] });
    },

    smoke: function (x, y, z, dark) {
      var g = dark ? 0.12 : 0.55;
      this.spawn(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.8, 2.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8,
        1.1 + Math.random() * 0.8, g, g, g);
    },

    explosion: function (x, y, z) {
      this.burst(x, y + 1, z, { count: 42, speed: 13, life: 1.1, color: [1, 0.45, 0.12] });
      this.burst(x, y + 1, z, { count: 20, speed: 7, life: 0.6, color: [1, 0.8, 0.3] });
      this.shake(0.85);
    },

    shake: function (amount) { trauma = Math.min(1, trauma + amount); },

    update: function (dt, camera) {
      if (points) {
        var pos = posAttr.array, col = colAttr.array;
        for (var i = 0; i < MAX; i++) {
          var p = pool[i];
          if (p.life > 0) {
            p.life -= dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.vy -= 1.4 * dt;
            if (p.life <= 0) p.y = -50;
          }
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          var f = Math.max(0, p.life / p.maxLife);
          col[i * 3] = p.r * f; col[i * 3 + 1] = p.g * f; col[i * 3 + 2] = p.b * f;
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }
      if (camera && trauma > 0.003) {
        var s = trauma * trauma * 0.5;
        camera.position.x += (Math.random() - 0.5) * s;
        camera.position.y += (Math.random() - 0.5) * s;
        trauma = Math.max(0, trauma - dt * 1.7);
      }
    }
  };

  SH.Effects = Effects;
})(window.SH = window.SH || {});
