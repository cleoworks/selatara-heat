// SELATARA HEAT — weather.js
// Light dynamic weather: clear spells alternate with short tropical rain
// showers. Rain is one THREE.Points sheet of streaks that follows the
// player; while it rains the road material darkens and loses a little grip
// (handled in vehicles via SH.Weather.gripFactor), and the sky grade greys.
// Public API: SH.Weather { init(scene), update(dt), setWeather(w), gripFactor }.
(function (SH) {
  'use strict';

  var COUNT = 900;
  var drops = null, dropPos = null;

  var Weather = {
    timer: 0,
    nextIn: 50 + Math.random() * 70,
    gripFactor: 1,
    rainMat: null,

    init: function (scene) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(COUNT * 3);
      for (var i = 0; i < COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 90;
        pos[i * 3 + 1] = Math.random() * 40;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
        this['_' + i] = Math.random(); // per-drop phase, reused as fall speed jitter
      }
      dropPos = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute('position', dropPos);
      this.rainMat = new THREE.PointsMaterial({
        color: 0xaac8e8, size: 0.55, transparent: true, opacity: 0,
        depthWrite: false, sizeAttenuation: true
      });
      drops = new THREE.Points(geo, this.rainMat);
      drops.frustumCulled = false;
      drops.visible = false;
      scene.add(drops);
    },

    setWeather: function (w) {
      SH.State.weather = w;
      this.timer = 0;
      this.nextIn = w === 'rain' ? 26 + Math.random() * 30 : 55 + Math.random() * 80;
      if (SH.HUD && SH.State.mode === 'playing') {
        SH.HUD.notify(w === 'rain' ? '🌧 Tropical shower rolling in — roads are slick' : '☀ The shower passes — clear skies');
      }
    },

    update: function (dt) {
      var st = SH.State;
      this.timer += dt;
      if (this.timer >= this.nextIn && st.mode === 'playing') {
        this.setWeather(st.weather === 'rain' ? 'clear' : 'rain');
      }
      var raining = st.weather === 'rain';
      // Grip + road sheen ease toward the weather state instead of snapping.
      var targetGrip = raining ? 0.82 : 1;
      this.gripFactor += (targetGrip - this.gripFactor) * Math.min(1, dt * 0.8);
      if (SH.Roads && SH.Roads.roadMaterials) {
        var mats = SH.Roads.roadMaterials;
        var baseShine = SH.Roads.baseShininess || 14;
        for (var mi = 0; mi < mats.length; mi++) {
          mats[mi].color.setHex(raining ? 0x848b96 : 0xffffff); // wet asphalt darkens
          mats[mi].shininess = raining ? baseShine + 42 : baseShine; // and turns glossy
        }
      }
      if (!drops) return;
      var target = raining ? 0.5 : 0;
      this.rainMat.opacity += (target - this.rainMat.opacity) * Math.min(1, dt * 2.2);
      drops.visible = this.rainMat.opacity > 0.02;
      if (!drops.visible) return;
      var f = st.driving ? st.vehiclePos : st.player;
      drops.position.set(f.x, 0, f.z);
      var pos = dropPos.array;
      for (var i = 0; i < COUNT; i++) {
        pos[i * 3 + 1] -= (26 + this['_' + i] * 10) * dt;
        pos[i * 3] += 3.5 * dt; // slant with the sea wind
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3] = (Math.random() - 0.5) * 90;
          pos[i * 3 + 1] = 34 + Math.random() * 8;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
        }
      }
      dropPos.needsUpdate = true;
    }
  };

  SH.Weather = Weather;
})(window.SH = window.SH || {});
