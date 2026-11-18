// SELATARA HEAT — buildings.js
// Instanced buildings with procedural canvas facades per district, plus the
// props that make districts read differently: palms, streetlights, port
// containers + cranes, night-market tents, boardwalk + pier, billboards, park.
// Public API: SH.Buildings { build(scene), setNightGlow(amount), windowMaterial }.
(function (SH) {
  'use strict';

  function facadeTexture(seed, litRatio, sign) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, 128, 256);
    var rng = SH.World.makeRng(seed);
    for (var y = 8; y < 244; y += 15) {
      for (var x = 8; x < 120; x += 17) {
        var lit = rng() < litRatio;
        g.fillStyle = lit ? '#54646c' : '#84929a';
        g.fillRect(x, y, 11, 10);
      }
    }
    if (sign) {
      g.fillStyle = sign;
      g.fillRect(0, 226, 128, 30);
      g.fillStyle = '#ffffff';
      g.font = 'bold 17px sans-serif';
      g.textAlign = 'center';
      g.fillText('SELATARA', 64, 248);
    }
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function makeInstanced(geo, mat, placements, scene, shadows) {
    var mesh = new THREE.InstancedMesh(geo, mat, placements.length);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var v = new THREE.Vector3(), s = new THREE.Vector3();
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      e.set(0, p.rotY || 0, 0); q.setFromEuler(e);
      v.set(p.x, p.y, p.z); s.set(p.sx, p.sy, p.sz);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
      if (p.color !== undefined) mesh.setColorAt(i, new THREE.Color(p.color));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!shadows; mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  var Buildings = {
    glowPoints: null,

    build: function (scene) {
      var cfg = SH.Config.world;
      var rng = SH.World.makeRng(4242);
      var palettes = SH.Config.buildingPalettes;

      // ---- Collect building placements per archetype ----
      var towers = [], shops = [], warehouses = [], villas = [];
      var xs = cfg.avenuesX, zs = cfg.streetsZ;
      for (var i = 0; i + 1 < xs.length; i++) {
        for (var j = 0; j + 1 < zs.length; j++) {
          var cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
          var d = SH.World.districtAt(cx, cz);
          if (!d || d.id === 'taman') continue;
          var bw = xs[i + 1] - xs[i] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          var bd = zs[j + 1] - zs[j] - cfg.roadHalf * 2 - cfg.sidewalk * 2 - 6;
          if (d.id === 'pelita') {
            var h = d.minH + rng() * (d.maxH - d.minH);
            var ox = (rng() - 0.5) * 14, oz = (rng() - 0.5) * 14;
            towers.push({ x: cx + ox, y: h / 2, z: cz + oz, sx: bw * 0.58, sy: h, sz: bd * 0.58, color: palettes.pelita[(rng() * palettes.pelita.length) | 0] });
            SH.World.colliders.push({ x: cx + ox, z: cz + oz, hx: bw * 0.29, hz: bd * 0.29 });
          } else if (d.id === 'ruko') {
            for (var k = 0; k < 4; k++) {
              var sx = xs[i] + 16 + k * ((xs[i + 1] - xs[i] - 32) / 3);
              var sh = d.minH + rng() * (d.maxH - d.minH);
              shops.push({ x: sx, y: sh / 2, z: cz - bd * 0.28, sx: 17, sy: sh, sz: bd * 0.4, color: palettes.ruko[(rng() * palettes.ruko.length) | 0] });
              SH.World.colliders.push({ x: sx, z: cz - bd * 0.28, hx: 8.5, hz: bd * 0.2 });
            }
          } else if (d.id === 'karat') {
            var wh = d.minH + rng() * (d.maxH - d.minH);
            warehouses.push({ x: cx, y: wh / 2, z: cz, sx: bw * 0.68, sy: wh, sz: bd * 0.62, color: palettes.karat[(rng() * palettes.karat.length) | 0] });
            SH.World.colliders.push({ x: cx, z: cz, hx: bw * 0.34, hz: bd * 0.31 });
          } else if (d.id === 'mawar') {
            for (var v2 = 0; v2 < 2; v2++) {
              var vx = cx + (v2 === 0 ? -bw * 0.24 : bw * 0.24);
              var vh = d.minH + rng() * (d.maxH - d.minH);
              villas.push({ x: vx, y: vh / 2, z: cz, sx: 20, sy: vh, sz: 18, color: palettes.mawar[(rng() * palettes.mawar.length) | 0] });
              SH.World.colliders.push({ x: vx, z: cz, hx: 10, hz: 9 });
            }
          } else if (d.id === 'kencana') {
            var kh = d.minH + rng() * (d.maxH - d.minH);
            towers.push({ x: cx, y: kh / 2, z: cz - 8, sx: bw * 0.7, sy: kh, sz: 20, color: palettes.kencana[(rng() * palettes.kencana.length) | 0] });
            SH.World.colliders.push({ x: cx, z: cz - 8, hx: bw * 0.35, hz: 10 });
          }
        }
      }

      var box = new THREE.BoxGeometry(1, 1, 1);
      var towerMat = new THREE.MeshLambertMaterial({ map: facadeTexture(11, 0.35, null) });
      var shopMat = new THREE.MeshLambertMaterial({ map: facadeTexture(23, 0.2, '#c94f7a') });
      var wareMat = new THREE.MeshLambertMaterial({ map: facadeTexture(37, 0.08, null), color: 0xbfb4a4 });
      var villaMat = new THREE.MeshLambertMaterial({ map: facadeTexture(51, 0.25, null) });
      makeInstanced(box, towerMat, towers, scene, true);
      makeInstanced(box, shopMat, shops, scene, true);
      makeInstanced(box, wareMat, warehouses, scene, true);
      makeInstanced(box, villaMat, villas, scene, true);
      this.windowMaterials = [towerMat, shopMat, villaMat];

      // ---- Palms + park trees (instanced trunk + crown) ----
      var trunks = [], crowns = [], treeCrowns = [];
      var pi;
      for (pi = 0; pi < 130; pi++) {
        var px = -560 + rng() * 1120, pz = 196 + rng() * 84;
        trunks.push({ x: px, y: 3, z: pz, sx: 0.5, sy: 6, sz: 0.5 });
        crowns.push({ x: px, y: 6.4, z: pz, sx: 5.4, sy: 1.6, sz: 5.4 });
      }
      for (pi = 0; pi < 90; pi++) {
        var tx = -560 + rng() * 1120, tz = -440 + rng() * 620;
        if (SH.World.districtAt(tx, tz) && SH.World.districtAt(tx, tz).id === 'taman' || (tx > -130 && tx < 130 && tz > -70 && tz < 190)) {
          trunks.push({ x: tx, y: 2.4, z: tz, sx: 0.6, sy: 4.8, sz: 0.6 });
          treeCrowns.push({ x: tx, y: 6.4, z: tz, sx: 5 + rng() * 3, sy: 4.6, sz: 5 + rng() * 3 });
        } else if ((pi % 3) === 0) {
          trunks.push({ x: tx, y: 3, z: tz, sx: 0.5, sy: 6, sz: 0.5 });
          crowns.push({ x: tx, y: 6.4, z: tz, sx: 5.2, sy: 1.5, sz: 5.2 });
        }
      }
      var trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
      var crownMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d, flatShading: true });
      var treeMat = new THREE.MeshLambertMaterial({ color: 0x4da653, flatShading: true });
      makeInstanced(new THREE.CylinderGeometry(0.32, 0.5, 1, 5), trunkMat, trunks, scene, false);
      makeInstanced(new THREE.ConeGeometry(0.5, 1, 7), crownMat, crowns, scene, false);
      makeInstanced(new THREE.IcosahedronGeometry(0.62, 0), treeMat, treeCrowns, scene, false);

      // Park pond.
      var pond = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshPhongMaterial({ color: 0x2e8fb5, shininess: 80 }));
      pond.rotation.x = -Math.PI / 2; pond.position.set(0, 0.03, 60);
      scene.add(pond);

      // ---- Streetlights: instanced poles + night glow points ----
      var lamps = SH.Roads.lampPositions;
      var poles = [];
      for (pi = 0; pi < lamps.length; pi++) poles.push({ x: lamps[pi].x, y: 3.4, z: lamps[pi].z, sx: 0.22, sy: 6.8, sz: 0.22 });
      makeInstanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }), poles, scene, false);
      var glowGeo = new THREE.BufferGeometry();
      var pos = new Float32Array(lamps.length * 3);
      for (pi = 0; pi < lamps.length; pi++) { pos[pi * 3] = lamps[pi].x; pos[pi * 3 + 1] = 6.9; pos[pi * 3 + 2] = lamps[pi].z; }
      glowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.glowMaterial = new THREE.PointsMaterial({ color: 0xffca7a, size: 3.2, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      this.glowPoints = new THREE.Points(glowGeo, this.glowMaterial);
      scene.add(this.glowPoints);

      // ---- Port: container stacks + cranes ----
      var containers = [];
      var contColors = [0xc94f4f, 0x4f7ac9, 0x37b24d, 0xe8b04b, 0x9a6ac9, 0x37e0ff];
      for (pi = 0; pi < 110; pi++) {
        var cx2 = 300 + rng() * 250, cz2 = 90 + rng() * 130;
        var lvl = (rng() * 3) | 0;
        containers.push({ x: cx2, y: 1.3 + lvl * 2.6, z: cz2, sx: 12, sy: 2.6, sz: 2.6, rotY: (rng() > 0.5 ? 0 : Math.PI / 2), color: contColors[(rng() * contColors.length) | 0] });
      }
      makeInstanced(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), containers, scene, true);
      var craneMat = new THREE.MeshLambertMaterial({ color: 0xe8b04b, flatShading: true });
      for (pi = 0; pi < 3; pi++) {
        var crane = new THREE.Group();
        var legG = new THREE.BoxGeometry(1.6, 30, 1.6);
        var positions = [[-9, -5], [9, -5], [-9, 5], [9, 5]];
        for (var li = 0; li < 4; li++) {
          var leg = new THREE.Mesh(legG, craneMat);
          leg.position.set(positions[li][0], 15, positions[li][1]);
          crane.add(leg);
        }
        var beam = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 2.2), craneMat);
        beam.position.set(6, 30, 0);
        crane.add(beam);
        crane.position.set(340 + pi * 95, 0, 205);
        scene.add(crane);
        SH.World.colliders.push({ x: crane.position.x, z: 205, hx: 11, hz: 7 });
      }

      // ---- Night-market tents in Ruko Senja ----
      var tents = [];
      var tentColors = [0xff4fa3, 0xffd23f, 0x37e0ff, 0xff8c5a, 0x9fd8c0];
      for (pi = 0; pi < 26; pi++) {
        var mx = -352 + (pi % 13) * 7.6, mz = 84 + ((pi / 13) | 0) * 16;
        tents.push({ x: mx, y: 2.6, z: mz, sx: 6.4, sy: 2.8, sz: 6.4, color: tentColors[(rng() * tentColors.length) | 0] });
      }
      makeInstanced(new THREE.ConeGeometry(0.72, 1, 4), new THREE.MeshLambertMaterial({ flatShading: true }), tents, scene, false);

      // ---- Boardwalk + pier at Pantai Kencana ----
      var woodMat = new THREE.MeshLambertMaterial({ color: 0xa87c50 });
      var board = new THREE.Mesh(new THREE.BoxGeometry(980, 0.5, 10), woodMat);
      board.position.set(0, 0.25, 246); board.receiveShadow = true;
      scene.add(board);
      var pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 110), woodMat);
      pier.position.set(60, 0.25, 340);
      scene.add(pier);
      this.pierEnd = { x: 60, z: 392 };
      var umbrellas = [];
      for (pi = 0; pi < 30; pi++) umbrellas.push({ x: -520 + rng() * 1040, y: 2.2, z: 262 + rng() * 22, sx: 4.6, sy: 1.4, sz: 4.6, color: tentColors[(rng() * tentColors.length) | 0] });
      makeInstanced(new THREE.ConeGeometry(0.6, 1, 8), new THREE.MeshLambertMaterial({ flatShading: true }), umbrellas, scene, false);

      // ---- Billboards in Pelita Heights (canvas sign textures, invented brands) ----
      var signs = [
        { text: 'SELATARA', sub: 'KOTA SELAT • PORT CITY', color: '#ff4fa3', x: -120, z: -308 },
        { text: 'KOPI SENJA', sub: 'KOPI PAGI • KOPI MALAM', color: '#ffd23f', x: 118, z: -188 },
        { text: 'HOTEL KENCANA', sub: 'PANTAI • BEACH', color: '#37e0ff', x: -238, z: 172 },
        { text: 'BENGKEL ARUS', sub: 'SERVIS • REPAIR 24 JAM', color: '#9fd8c0', x: 238, z: -68 }
      ];
      for (pi = 0; pi < signs.length; pi++) {
        var s = signs[pi];
        var sc = document.createElement('canvas'); sc.width = 256; sc.height = 128;
        var sg = sc.getContext('2d');
        sg.fillStyle = '#14101e'; sg.fillRect(0, 0, 256, 128);
        sg.fillStyle = s.color; sg.font = 'bold 30px sans-serif'; sg.textAlign = 'center';
        sg.fillText(s.text, 128, 56);
        sg.fillStyle = '#e8e3d8'; sg.font = '15px sans-serif';
        sg.fillText(s.sub, 128, 88);
        var sm = new THREE.Mesh(new THREE.PlaneGeometry(22, 11),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide }));
        sm.position.set(s.x, 17, s.z);
        sm.rotation.y = (pi % 2) ? Math.PI / 2 : 0;
        scene.add(sm);
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 5), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
        pole.position.set(s.x, 6, s.z);
        scene.add(pole);
      }
    },

    setNightGlow: function (amount) {
      if (this.glowMaterial) this.glowMaterial.opacity = amount * 0.85;
    }
  };

  SH.Buildings = Buildings;
})(window.SH = window.SH || {});
