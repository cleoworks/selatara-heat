// SELATARA HEAT — input.js
// Keyboard + mouse state, Pointer Lock mouse look, edge-triggered key events.
// Mouse look applies only while the canvas holds pointer lock; losing the
// lock (Esc) is treated as a pause request by the menu layer.
// Public API: SH.Input { keys, pressed, mouseDX/DY, locked, init(canvas), isDown(code), wasPressed(code), endFrame() }.
(function (SH) {
  'use strict';

  var Input = {
    keys: {},
    pressed: {},
    mouseDX: 0, mouseDY: 0,
    mouseDown: false, aimDown: false,
    locked: false,
    sensitivity: 1,

    init: function (canvas) {
      var self = this;
      window.addEventListener('keydown', function (e) {
        if (!self.keys[e.code]) self.pressed[e.code] = true;
        self.keys[e.code] = true;
        if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
      window.addEventListener('blur', function () { self.keys = {}; self.mouseDown = false; self.aimDown = false; });
      canvas.addEventListener('click', function () {
        if (!self.locked && SH.State && SH.State.mode === 'playing') {
          try {
            var r = canvas.requestPointerLock();
            if (r && r.catch) r.catch(function () { /* cooldown; click again */ });
          } catch (err) { /* pointer lock unavailable */ }
        }
      });
      document.addEventListener('pointerlockchange', function () {
        self.locked = document.pointerLockElement === canvas;
      });
      document.addEventListener('mousemove', function (e) {
        if (!self.locked) return;
        self.mouseDX += e.movementX * self.sensitivity;
        self.mouseDY += e.movementY * self.sensitivity;
      });
      canvas.addEventListener('mousedown', function (e) {
        if (e.button === 0) self.mouseDown = true;
        if (e.button === 2) self.aimDown = true;
      });
      window.addEventListener('mouseup', function (e) {
        if (e.button === 0) self.mouseDown = false;
        if (e.button === 2) self.aimDown = false;
      });
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    },

    isDown: function (code) { return !!this.keys[code]; },
    wasPressed: function (code) { return !!this.pressed[code]; },

    endFrame: function () {
      this.pressed = {};
      this.mouseDX = 0;
      this.mouseDY = 0;
    }
  };

  SH.Input = Input;
})(window.SH = window.SH || {});
