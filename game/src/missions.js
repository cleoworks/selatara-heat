// SELATARA HEAT — missions.js
// The mission runner: a data-driven step state machine (goTo / enterVehicle /
// deliver / chasePed / kill / escape / survive / driveTo) with dialogue
// playback, checkpoints, fail + retry, cash rewards and autosave, plus the
// opening cinematic. All eight missions of the Arus Syndicate arc are built
// here, ending with the ferry finale, credits and the free-roam unlock.
// Public API: SH.Missions { list[], currentIndex, startIntro(), startMission(i),
//   update(dt), updateCutscene(dt, camera), setObjective(), clearObjective() }.
(function (SH) {
  'use strict';

  var SAFEHOUSE = { x: -368, z: 84 };

  // ---- dialogue helper -------------------------------------------------------
  var Dialog = {
    queue: [], timer: 0,
    play: function (lines) {
      for (var i = 0; i < lines.length; i++) this.queue.push(lines[i]);
      if (this.timer <= 0) this.next();
    },
    next: function () {
      var line = this.queue.shift();
      if (!line) { this.timer = 0; return; }
      if (SH.HUD) SH.HUD.subtitle(line[0], line[1], line[2] || 3.4);
      this.timer = line[2] || 3.4;
    },
    update: function (dt) {
      if (this.timer > 0) {
        this.timer -= dt;
        if (this.timer <= 0) this.next();
      }
    },
    clear: function () { this.queue = []; this.timer = 0; }
  };

  // The courier uses the shared figure builder (Art Pass 3) plus his red
  // parcel backpack, so he matches the rest of the cast.
  function buildCourierMesh() {
    var built = SH.Pedestrians.buildFigure({
      skin: 0x8a5a34,
      shirt: 0xffd23f,
      pants: 0x30364a,
      hairColor: 0x14100c,
      hairStyle: 'cap',
      face: 2
    });
    var pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.44, 0.18),
      new THREE.MeshLambertMaterial({ color: 0xc94f4f, flatShading: true })
    );
    pack.position.set(0, 1.24, -0.24); pack.castShadow = true;
    built.group.add(pack);
    return built;
  }

  // ---- mission definitions -----------------------------------------------------
  // Each mission: steps[] of typed steps. Optional per-mission hooks:
  // onStart(run), onStep(run, step), onUpdate(run, dt) for scripted events.
  function defs() {
    return [
      {
        id: 'first-run', title: 'FIRST RUN', giver: 'Mami Ratna', reward: 400,
        brief: 'Deliver a package from Ruko Senja to Pantai Kencana.',
        steps: [
          { type: 'goTo', x: -318, z: 70, r: 4.5, text: 'Pick up the package behind the night market',
            say: [['Mami Ratna', 'Raka. You still owe the Syndicate. Start small: a package, behind my market stalls.', 4.2],
                  ['Raka', 'One package. Then we talk about the rest of the debt.', 3.2]] },
          { type: 'goTo', x: 60, z: 178, r: 6, text: 'Deliver the package to Butik Kencana',
            say: [['Mami Ratna', 'Take it to the boutique on the beach road. Drive like you mean it — but no police.', 4]] },
          { type: 'goTo', x: 60, z: 246, r: 6, text: 'Park on the boardwalk to finish the handover',
            say: [['Boutique Owner', 'You are late. Mami\u2019s boy, hm? Tell her the shelf is stocked.', 3.6]] }
        ]
      },
      {
        id: 'night-market', title: 'NIGHT MARKET RUN', giver: 'Mami Ratna', reward: 650,
        brief: 'Catch the courier running through the Ruko Senja night market.',
        setHour: 20.4,
        steps: [
          { type: 'goTo', x: -330, z: 70, r: 5, text: 'Reach the night market entrance',
            say: [['Mami Ratna', 'My courier saw Varga\u2019s men and ran. Catch him — alive, Raka. He carries my ledger.', 4.4]] },
          { type: 'chasePed', text: 'Catch the courier (get close on foot)', timeLimit: 170,
            say: [['Courier', 'Stay away from me! I know what is in this bag!', 3],
                  ['Raka', 'Then stop running and hand it over!', 2.8]] },
          { type: 'goTo', x: SAFEHOUSE.x, z: SAFEHOUSE.z, r: 6, text: 'Return to the safehouse',
            say: [['Courier', 'Fine! Take the ledger. Tell Mami the port is crawling with Varga\u2019s people.', 4]] }
        ]
      },
      {
        id: 'port-of-lies', title: 'PORT OF LIES', giver: 'Mami Ratna', reward: 900,
        brief: 'Steal a container truck from Pelabuhan Karat and lose the police.',
        steps: [
          { type: 'goTo', x: 322, z: 78, r: 9, text: 'Reach the container truck at Pelabuhan Karat',
            say: [['Mami Ratna', 'A Bara truck in the port carries Dario\u2019s cargo — and my name on the manifest. Take it.', 4.4]] },
          { type: 'enterVehicle', vehicle: 'portTruck', text: 'Steal the container truck (F)',
            say: [['Raka', 'This is going to be loud.', 2.4]] },
          { type: 'deliver', x: 472, z: 66, r: 9, text: 'Drive the truck to the east warehouse gate',
            say: [['Mami Ratna', 'The whole port saw that. Lose the sirens before you park it!', 3.8]] },
          { type: 'escape', text: 'Lose the police completely',
            say: [['Raka', 'Quiet streets. Side alleys. Come on…', 3]] }
        ]
      },
      {
        id: 'escort-mami', title: 'ESCORT MAMI', giver: 'Mami Ratna', reward: 1200,
        brief: 'Drive Mami Ratna across town while rival crews try to stop her car.',
        steps: [
          { type: 'goTo', x: -360, z: 100, r: 6, text: 'Meet Mami at her car by the safehouse',
            say: [['Mami Ratna', 'Tonight you drive me. Varga wants a meeting; Dario wants me gone. Keep my car in one piece.', 4.6]] },
          { type: 'enterVehicle', vehicle: 'mamiCar', text: 'Get in Mami\u2019s car (F)',
            say: [['Mami Ratna', 'Gentle with her. She is older than your debt.', 3]] },
          { type: 'driveTo', x: 246, z: 42, r: 9, text: 'Drive Mami to Bengkel Arus',
            say: [['Mami Ratna', 'Eyes on the road. If teal cars follow us, you know what to do.', 3.8]] },
          { type: 'goTo', x: 246, z: 54, r: 7, text: 'Step out and report to the workshop',
            say: [['Mami Ratna', 'Still breathing. You drive like the old days, Raka.', 3.6]] }
        ]
      },
      {
        id: 'hilltop-repo', title: 'HILLTOP REPO', giver: 'Bengkel Arus', reward: 1100,
        brief: 'Repossess a sport car from a Bukit Mawar villa and deliver it to Bengkel Arus.',
        steps: [
          { type: 'goTo', x: 330, z: -240, r: 7, text: 'Reach the villa in Bukit Mawar',
            say: [['Bengkel Arus', 'A client in Bukit Mawar stopped paying for his Arus GT. The car is ours — go take it back.', 4.2],
                  ['Raka', 'Rich hill, quiet streets. What could go wrong.', 3]] },
          { type: 'enterVehicle', vehicle: 'repoCar', text: 'Take the Arus GT (F)',
            say: [['Raka', 'Keys in the visor. Amateurs.', 2.6]] },
          { type: 'driveTo', x: 246, z: 66, r: 9, text: 'Deliver the car to Bengkel Arus',
            say: [['Bengkel Arus', 'The owner called Varga\u2019s men. Expect roadblocks — bring her home anyway.', 4]] },
          { type: 'escape', text: 'Lose the police completely',
            say: [['Raka', 'One repo, two stars. The hill keeps its secrets.', 3]] }
        ]
      },
      {
        id: 'kencana-heist', title: 'THE KENCANA HEIST', giver: 'Mami Ratna', reward: 2000,
        brief: 'Rob the boardwalk jewellery store and escape by boat.',
        setHour: 19.2,
        steps: [
          { type: 'goTo', x: 60, z: 214, r: 6, text: 'Case the jewellery store on the boardwalk',
            say: [['Mami Ratna', 'Permata Kencana, on the boardwalk. Dario\u2019s stones in the window, my name on the lease. Take them back.', 4.6],
                  ['Raka', 'Smash, grab, and the boat at the pier. Loud and simple.', 3.2]] },
          { type: 'goTo', x: 60, z: 388, r: 7, text: 'Run to the speedboat at the end of the pier',
            say: [['Mami Ratna', 'The alarm is singing, Raka. The boat. Now.', 3.2]] },
          { type: 'enterVehicle', vehicle: 'heistBoat', text: 'Take the speedboat (F)',
            say: [['Raka', 'Water has no roadblocks.', 2.4]] },
          { type: 'driveTo', x: -420, z: 330, r: 16, text: 'Cross the bay to the west hideout',
            say: [['Mami Ratna', 'Across the strait, to the old boathouse. Do not stop for the harbour lights.', 4]] },
          { type: 'escape', text: 'Lose the police completely',
            say: [['Raka', 'Salt air and quiet water. Done.', 3]] }
        ]
      },
      {
        id: 'double-cross', title: 'DOUBLE CROSS', giver: 'Unknown', reward: 1800,
        brief: 'Survive Commissioner Varga\u2019s trap in a port warehouse.',
        setHour: 21.1,
        steps: [
          { type: 'goTo', x: 330, z: 120, r: 9, text: 'Meet the contact at the east warehouse',
            say: [['Unknown', 'Come alone to the east warehouse, Raka. Varga wants to settle accounts.', 4],
                  ['Raka', 'A midnight meeting in a warehouse. Nothing about this smells right.', 3.6]] },
          { type: 'survive', seconds: 45, text: 'Survive the ambush',
            say: [['Commissioner Varga', 'You should have stayed in prison, Pramudya. Boys — take him.', 4],
                  ['Raka', 'A trap. Of course it is a trap!', 2.6]] },
          { type: 'kill', text: 'Finish Varga\u2019s crew',
            say: [['Raka', 'Tell Varga the strait settles its own accounts!', 3.2]] },
          { type: 'escape', text: 'Lose the police completely',
            say: [['Mami Ratna', 'Varga played his hand and lost. Come home, Raka.', 3.6]] }
        ]
      },
      {
        id: 'last-ferry', title: 'LAST FERRY OUT', giver: 'Mami Ratna', reward: 3000,
        brief: 'Chase Dario \u201CKapten\u201D Latu to the last ferry and end this.',
        setHour: 18.05,
        steps: [
          { type: 'goTo', x: 60, z: 300, r: 8, text: 'Reach the ferry pier — Dario is leaving',
            say: [['Mami Ratna', 'Dario is running for the last ferry with the Syndicate\u2019s strongbox. End this, Raka — and the debt dies with it.', 4.8]] },
          { type: 'chaseCar', seconds: 75, timeLimit: 170, text: 'Run Dario\u2019s car down (stay on him)',
            say: [['Dario Latu', 'The strait is mine, driver! You are just the help!', 3.4],
                  ['Raka', 'Not tonight, Kapten.', 2.4]] },
          { type: 'goTo', x: 60, z: 384, r: 8, text: 'Confront Dario at the ferry ramp',
            say: [['Dario Latu', 'You want the strongbox? Come and take it — my boys are hungry!', 3.6]] },
          { type: 'kill', text: 'End Dario\u2019s crew',
            say: [['Raka', 'It ends here, Kapten.', 2.6]] },
          { type: 'escape', text: 'Lose the police completely',
            say: [['Mami Ratna', 'It is over, Raka. The ferry, the strait, the debt — all of it. You are free.', 4.4]] }
        ]
      }
    ];
  }

  var Missions = {
    list: defs(),
    currentIndex: 0,
    active: null,       // { def, stepIndex, checkpoint, stepData, failed }
    courier: null,
    ambushStage: 0,

    setObjective: function (title, text, x, z) {
      SH.State.objective = { title: title, text: text, x: x, z: z };
    },
    clearObjective: function () { SH.State.objective = null; },

    startIntroObjective: function () {
      this.setObjective('FIRST RUN', 'Meet Mami Ratna at the safehouse', SAFEHOUSE.x, SAFEHOUSE.z);
      this.phase = 'briefing';
    },

    // ---- intro cutscene ---------------------------------------------------------
    startIntro: function () {
      var st = SH.State;
      st.mode = 'cutscene';
      st.cutscene = true;
      var title = document.getElementById('title-screen');
      if (title) title.classList.add('hidden');
      var hud = document.getElementById('hud');
      if (hud) hud.classList.remove('hidden');
      this.csTime = 0;
      this.csShot = 0;
      var lb = document.getElementById('letterbox-top');
      var lb2 = document.getElementById('letterbox-bottom');
      if (lb) lb.classList.remove('hidden');
      if (lb2) lb2.classList.remove('hidden');
      this.csLines = [
        [0.5, 'Narrator', 'Selatara. A strait city of neon, salt and old debts.', 4],
        [5.0, 'Narrator', 'Raka Pramudya walked out of prison with nothing but a name the Arus Syndicate still owns.', 4.6],
        [10.0, 'Mami Ratna', 'Eight jobs, Raka. Pay the debt, and the strait is yours again.', 4],
        [14.6, 'Narrator', 'But Commissioner Varga takes a cut of everything — and Dario Latu wants the whole strait.', 4.6]
      ];
      this.csLineIdx = 0;
      if (SH.HUD) SH.HUD.subtitle('Narrator', 'Selatara. A strait city of neon, salt and old debts.', 4);
    },

    updateCutscene: function (dt, camera) {
      var st = SH.State;
      var input = SH.Input;
      this.csTime += dt;
      // Skip on Esc / Space / click.
      if (input.wasPressed('Escape') || input.wasPressed('Space') || input.mouseDown) { this.endIntro(); return; }
      while (this.csLineIdx < this.csLines.length && this.csTime >= this.csLines[this.csLineIdx][0]) {
        var line = this.csLines[this.csLineIdx++];
        if (SH.HUD) SH.HUD.subtitle(line[1], line[2], line[3]);
      }
      // Three slow cinematic shots: harbour dawn, downtown towers, market street.
      var shots = [
        { from: [120, 26, 330], to: [40, 14, 250], look: [0, 8, 200], dur: 6.5 },
        { from: [-190, 34, -300], to: [-120, 20, -210], look: [-120, 26, -160], dur: 6.5 },
        { from: [-420, 7, 130], to: [-368, 4.5, 92], look: [-360, 2, 84], dur: 6.5 }
      ];
      var t = this.csTime, acc = 0, shot = shots[shots.length - 1], local = 1;
      for (var i = 0; i < shots.length; i++) {
        if (t < acc + shots[i].dur) { shot = shots[i]; local = (t - acc) / shots[i].dur; break; }
        acc += shots[i].dur;
      }
      var e = local * local * (3 - 2 * local);
      camera.position.set(
        shot.from[0] + (shot.to[0] - shot.from[0]) * e,
        shot.from[1] + (shot.to[1] - shot.from[1]) * e,
        shot.from[2] + (shot.to[2] - shot.from[2]) * e);
      camera.lookAt(shot.look[0], shot.look[1], shot.look[2]);
      camera.fov = 55; camera.updateProjectionMatrix();
      if (this.csTime >= 19.5) this.endIntro();
    },

    endIntro: function () {
      var st = SH.State;
      st.mode = 'playing';
      st.cutscene = false;
      var lb = document.getElementById('letterbox-top');
      var lb2 = document.getElementById('letterbox-bottom');
      if (lb) lb.classList.add('hidden');
      if (lb2) lb2.classList.add('hidden');
      var camera = SH.Main.getCamera();
      if (camera) { camera.fov = 60; camera.updateProjectionMatrix(); }
      this.startIntroObjective();
      if (SH.Menus) SH.Menus.syncMode();
      if (SH.HUD) SH.HUD.banner('SELATARA HEAT', 'Meet Mami Ratna at the safehouse in Ruko Senja', 3.2, false);
    },

    // ---- mission lifecycle ---------------------------------------------------------
    startMission: function (index) {
      var def = this.list[index];
      if (!def) return;
      if (def.locked) {
        if (SH.HUD) SH.HUD.notify(def.title + ' unlocks in the next chapter drop');
        return;
      }
      this.currentIndex = index;
      if (def.setHour !== undefined) SH.Main.setHour(def.setHour);
      this.active = { def: def, stepIndex: 0, checkpoint: 0, stepData: {}, failed: 0, eventFlags: {} };
      this.ambushStage = 0;
      if (SH.HUD) SH.HUD.banner(def.title, def.brief, 3.4, false);
      this.beginStep();
    },

    beginStep: function () {
      var run = this.active;
      if (!run) return;
      var step = run.def.steps[run.stepIndex];
      if (!step) { this.completeMission(); return; }
      run.stepData = { t: 0 };
      run.checkpoint = run.stepIndex;
      if (step.say) Dialog.play(step.say);
      this.syncObjective(step);
      if (run.def.id === 'port-of-lies') this.portStepSetup(run, step);
      if (run.def.id === 'escort-mami') this.escortStepSetup(run, step);
      if (run.def.id === 'hilltop-repo') this.repoStepSetup(run, step);
      if (run.def.id === 'kencana-heist') this.heistStepSetup(run, step);
      if (run.def.id === 'double-cross') this.crossStepSetup(run, step);
      if (run.def.id === 'last-ferry') this.ferryStepSetup(run, step);
      if (run.def.id === 'night-market' && step.type === 'chasePed') this.spawnCourier();
    },

    syncObjective: function (step) {
      var run = this.active;
      var x = step.x, z = step.z;
      if (step.type === 'enterVehicle' && run.stepData.targetVeh) { x = run.stepData.targetVeh.x; z = run.stepData.targetVeh.z; }
      if (step.type === 'chasePed' && this.courier) { x = this.courier.x; z = this.courier.z; }
      if (step.type === 'escape') { this.setObjective(run.def.title, step.text, SH.State.player.x, SH.State.player.z); return; }
      if (x === undefined) { this.clearObjective(); return; }
      this.setObjective(run.def.title, step.text, x, z);
    },

    completeMission: function () {
      var run = this.active;
      var st = SH.State;
      var finishedIndex = this.currentIndex;
      this.active = null;
      this.removeCourier();
      if (SH.Combat) SH.Combat.clearEnemies();
      st.stats.missionsDone = Math.max(st.stats.missionsDone, finishedIndex + 1);
      SH.Economy.addCash(run.def.reward);
      if (SH.Audio) SH.Audio.cash();
      if (SH.HUD) SH.HUD.banner('MISSION COMPLETE', run.def.title + ' — $' + run.def.reward, 3.4, false);
      this.currentIndex = Math.min(finishedIndex + 1, this.list.length - 1);
      // Finale: the story is done — credits roll, free roam unlocks, and the
      // save carries the "story complete" mark from here on.
      if (finishedIndex >= this.list.length - 1) {
        st.storyComplete = true;
        this.phase = 'free';
        this.setObjective('FREE ROAM', 'Story complete — Selatara is yours. The city never sleeps.', SAFEHOUSE.x, SAFEHOUSE.z);
        if (SH.Save) SH.Save.saveGame();
        this.showCredits();
        return;
      }
      if (SH.Save) SH.Save.saveGame();
      // Chain: the next briefing waits at the safehouse.
      this.phase = 'briefing';
      this.setObjective(this.list[this.currentIndex].title, 'Meet Mami Ratna at the safehouse', SAFEHOUSE.x, SAFEHOUSE.z);
    },

    // End-of-story credits overlay (DOM, dismissed with a click / Esc).
    showCredits: function () {
      var el = document.getElementById('credits');
      if (!el) return;
      el.classList.remove('hidden');
      if (SH.HUD) SH.HUD.banner('STORY COMPLETE', 'LAST FERRY OUT — the debt is paid', 4, false);
      var hide = function () {
        el.classList.add('hidden');
        window.removeEventListener('keydown', onKey);
      };
      var onKey = function (e) { if (e.code === 'Escape' || e.code === 'Space') hide(); };
      el.addEventListener('click', hide);
      window.addEventListener('keydown', onKey);
      setTimeout(hide, 14000);
    },

    failMission: function (reason) {
      var run = this.active;
      if (!run || run.failed) return;
      run.failed = 1;
      Dialog.clear();
      if (SH.HUD) SH.HUD.banner('MISSION FAILED', reason + ' — retrying from checkpoint', 3, true);
      var self = this;
      setTimeout(function () {
        if (!self.active) return;
        self.active.failed = 0;
        self.active.stepIndex = self.active.checkpoint;
        // Undo the worst side effects of the failed attempt.
        if (SH.State.wanted > 0 && SH.Police) SH.Police.clearWanted();
        if (SH.Combat) SH.Combat.clearEnemies();
        self.removeCourier();
        self.beginStep();
      }, 3100);
    },

    // ---- mission-specific setups -------------------------------------------------------
    findVehicleNear: function (x, z, type) {
      var best = null, bd = Infinity;
      for (var i = 0; i < SH.Vehicles.list.length; i++) {
        var v = SH.Vehicles.list[i];
        if (type && v.type !== type) continue;
        var d = Math.hypot(v.x - x, v.z - z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },

    portStepSetup: function (run, step) {
      if (step.type === 'enterVehicle') {
        var truck = this.findVehicleNear(330, 66, 'truck');
        if (truck) {
          truck.hp = 100; truck.dead = false; truck.mesh.visible = true;
          run.stepData.targetVeh = truck;
          this.syncObjective(step);
        }
      }
      if (step.type === 'deliver' && !run.eventFlags.portAlarm) {
        run.eventFlags.portAlarm = true;
        if (SH.Police) SH.Police.forceWanted(3);
      }
    },

    escortStepSetup: function (run, step) {
      if (step.type === 'enterVehicle') {
        var scene = SH.Main.getScene();
        if (!run.eventFlags.mamiCar && scene) {
          var car = SH.Vehicles.spawnVehicle(scene, 'sedan', 0xff4fa3, -358, 100, Math.PI / 2);
          car.driver = 'parked';
          run.eventFlags.mamiCar = car;
        }
        if (run.eventFlags.mamiCar) {
          run.stepData.targetVeh = run.eventFlags.mamiCar;
          run.stepData.mamiCar = run.eventFlags.mamiCar;
          this.syncObjective(step);
        }
      }
    },

    // Hilltop Repo: the target GT waits at the villa; taking it raises 2 stars.
    repoStepSetup: function (run, step) {
      if (step.type === 'enterVehicle') {
        // stepData resets every step, so the car itself is kept on
        // eventFlags (persistent) and re-pointed into stepData here.
        if (!run.eventFlags.repoCar) {
          var scene = SH.Main.getScene();
          if (!scene) return;
          var car = SH.Vehicles.spawnVehicle(scene, 'sport', 0xffb020, 330, -240, Math.PI);
          car.driver = 'parked';
          run.eventFlags.repoCar = car;
        }
        run.stepData.targetVeh = run.eventFlags.repoCar;
        this.syncObjective(step);
      }
      if (step.type === 'driveTo' && !run.eventFlags.repoAlarm) {
        run.eventFlags.repoAlarm = true;
        if (SH.Police) SH.Police.forceWanted(2);
      }
    },

    // Kencana Heist: the getaway boat waits at the pier end from the start.
    heistStepSetup: function (run, step) {
      if (!run.eventFlags.boat) {
        var scene = SH.Main.getScene();
        if (scene) {
          var boat = SH.Vehicles.spawnVehicle(scene, 'boat', 0xffffff, 60, 394, 0);
          boat.driver = 'parked';
          run.eventFlags.boat = boat;
        }
      }
      if (step.type === 'enterVehicle') {
        run.stepData.boat = run.eventFlags.boat;
        run.stepData.targetVeh = run.eventFlags.boat;
        this.syncObjective(step);
      }
      if (step.type === 'driveTo' && !run.eventFlags.heistAlarm) {
        run.eventFlags.heistAlarm = true;
        if (SH.Police) SH.Police.forceWanted(3);
        Dialog.play([['Raka', 'Harbour lights behind me. Open water ahead.', 3]]);
      }
    },

    // Double Cross: Varga's ambush — two shootout waves during SURVIVE, a
    // reinforcement wave for the KILL step, police heat from the gunfire.
    crossStepSetup: function (run, step) {
      if (step.type === 'survive' && !run.eventFlags.dcAmbush) {
        run.eventFlags.dcAmbush = true;
        if (SH.Police) SH.Police.forceWanted(3);
        for (var i = 0; i < 4; i++) {
          SH.Combat.spawnEnemy(330 + (i - 1.5) * 9, 120 + (i % 2) * 22 - 11, { color: 0x2a3f8f, hp: 50, damage: 7, name: 'Varga\u2019s men' });
        }
        if (SH.HUD) SH.HUD.notify('Ambush! Survive the warehouse shootout');
      }
      if (step.type === 'kill' && !run.eventFlags.dcWave2) {
        run.eventFlags.dcWave2 = true;
        for (var j = 0; j < 3; j++) {
          SH.Combat.spawnEnemy(316 + j * 14, 138, { color: 0x2a3f8f, hp: 50, damage: 7, name: 'Varga\u2019s men' });
        }
      }
    },

    crossEvents: function (run, dt) {
      var step = run.def.steps[run.stepIndex];
      if (step.type !== 'survive') return;
      var t = run.stepData.t;
      if (!run.eventFlags.dcWaveB && t > 22) {
        run.eventFlags.dcWaveB = true;
        for (var i = 0; i < 3; i++) {
          SH.Combat.spawnEnemy(344 - i * 12, 104, { color: 0x274b4f, hp: 45, damage: 7, name: 'Varga\u2019s men' });
        }
        Dialog.play([['Commissioner Varga', 'More men! He does not leave this warehouse!', 3.2]]);
      }
    },

    // Last Ferry Out: Dario's car flees around the bay road; stay on him to
    // run him down, then his crew makes a stand at the ferry ramp.
    ferryStepSetup: function (run, step) {
      if (step.type === 'chaseCar' && !run.eventFlags.darioCar) {
        var scene = SH.Main.getScene();
        if (!scene) return;
        var car = SH.Vehicles.spawnVehicle(scene, 'sport', 0x22242c, 60, 306, 0);
        car.driver = 'parked';
        run.eventFlags.darioCar = car;
        run.stepData.darioCar = car;
        run.stepData.chaseT = 0;
        this.syncObjective(step);
      }
      if (step.type === 'kill' && !run.eventFlags.dcFinale) {
        run.eventFlags.dcFinale = true;
        if (SH.Police) SH.Police.forceWanted(4);
        for (var i = 0; i < 4; i++) {
          SH.Combat.spawnEnemy(48 + i * 8, 372 + (i % 2) * 10, { color: 0x1f6f6f, hp: 55, damage: 8, name: 'Dario\u2019s crew' });
        }
        if (SH.HUD) SH.HUD.notify('Dario\u2019s last stand — finish it');
      }
    },

    // Dario drives a loop around the bay streets; the chase completes when
    // Raka keeps him in reach long enough (cumulative pressure) or the car
    // is wrecked. Losing him for good fails the step.
    updateDarioCar: function (run, dt) {
      var car = run.eventFlags.darioCar || run.stepData.darioCar;
      if (!car) return false;
      var st = SH.State;
      var route = [
        { x: 60, z: 306 }, { x: 114, z: 228 }, { x: 60, z: 120 }, { x: -114, z: 66 },
        { x: -234, z: 120 }, { x: -114, z: 228 }, { x: 6, z: 234 }, { x: 60, z: 306 }
      ];
      if (car.dead) return true;
      if (run.stepData.darioWp === undefined) run.stepData.darioWp = 1;
      var wp = route[run.stepData.darioWp % route.length];
      var dx = wp.x - car.x, dz = wp.z - car.z;
      var dist = Math.hypot(dx, dz);
      if (dist < 12) run.stepData.darioWp++;
      var targetHeading = Math.atan2(dx / (dist || 1), dz / (dist || 1));
      var diff = ((targetHeading - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      car.heading += Math.max(-1.7 * dt, Math.min(1.7 * dt, diff));
      var spd = car.spec.maxSpeed * 0.62;
      car.speed += Math.max(-14 * dt, Math.min(10 * dt, spd - car.speed));
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      SH.Vehicles.collideWorld(car, dt);
      SH.Vehicles.syncMesh(car);
      // Pressure: time spent within 26 m of Dario's tail.
      var f = st.driving ? st.vehiclePos : st.player;
      var pd = Math.hypot(f.x - car.x, f.z - car.z);
      if (pd < 26) run.stepData.chaseT += dt;
      this.setObjective(run.def.title, run.def.steps[run.stepIndex].text + ' (' + Math.round(run.stepData.chaseT) + 's pressure)', car.x, car.z);
      return run.stepData.chaseT >= (run.def.steps[run.stepIndex].seconds || 75) * 0.34;
    },

    spawnCourier: function () {
      this.removeCourier();
      var scene = SH.Main.getScene();
      var built = buildCourierMesh();
      scene.add(built.group);
      var route = [
        { x: -330, z: 70 }, { x: -300, z: 84 }, { x: -330, z: 108 }, { x: -286, z: 96 },
        { x: -300, z: 60 }, { x: -352, z: 60 }, { x: -368, z: 96 }, { x: -330, z: 70 }
      ];
      this.courier = {
        mesh: built.group, parts: built, x: -322, z: 76, heading: 0,
        route: route, wp: 1, cycle: 0, speed: 5.1
      };
    },

    removeCourier: function () {
      if (this.courier && this.courier.mesh.parent) this.courier.mesh.parent.remove(this.courier.mesh);
      this.courier = null;
    },

    updateCourier: function (dt) {
      var c = this.courier;
      if (!c) return false;
      var st = SH.State, p = st.player;
      var target = c.route[c.wp];
      var dx = target.x - c.x, dz = target.z - c.z;
      var d = Math.hypot(dx, dz);
      // The courier speeds up when Raka closes in, tires over time.
      var distP = Math.hypot(p.x - c.x, p.z - c.z);
      var spd = c.speed * (distP < 16 ? 1.12 : 0.94);
      if (d < 2) { c.wp = (c.wp + 1) % c.route.length; return distP < 2.6; }
      c.heading = Math.atan2(dx / d, dz / d);
      c.x += Math.sin(c.heading) * spd * dt;
      c.z += Math.cos(c.heading) * spd * dt;
      c.cycle += dt * spd * 2.8;
      var s = Math.sin(c.cycle * 2.2) * 0.6;
      c.parts.legL.rotation.x = s; c.parts.legR.rotation.x = -s;
      c.parts.armL.rotation.x = -s * 0.85; c.parts.armR.rotation.x = s * 0.85;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
      // Keep the objective marker glued to the courier.
      if (this.active && this.active.def.steps[this.active.stepIndex].type === 'chasePed') {
        this.setObjective(this.active.def.title, this.active.def.steps[this.active.stepIndex].text, c.x, c.z);
      }
      return distP < 2.6 && !st.driving;
    },

    // Escort ambushes: teal rival crews at two choke points on the route east.
    escortEvents: function (run, dt) {
      var st = SH.State;
      var car = run.eventFlags.mamiCar || run.stepData.mamiCar;
      if (!st.driving || !car) return;
      if (car.dead) { this.failMission('Mami\u2019s car was destroyed'); return; }
      var stage = this.ambushStage;
      var triggers = [
        { x: -120, z: 66, n: 3 }, { x: 118, z: 66, n: 4 }
      ];
      if (stage < triggers.length) {
        var tr = triggers[stage];
        if (Math.hypot(st.vehiclePos.x - tr.x, st.vehiclePos.z - tr.z) < 85) {
          this.ambushStage++;
          for (var i = 0; i < tr.n; i++) {
            SH.Combat.spawnEnemy(tr.x + (i - 1.5) * 6, tr.z - 14 + (i % 2) * 26, { color: 0x1f6f6f, hp: 40, damage: 6 });
          }
          Dialog.play([['Mami Ratna', 'Teal cars! Raka — drive, or fight, but do not stop!', 3.4]]);
          if (SH.HUD) SH.HUD.notify('Ambush! Protect Mami\u2019s car');
        }
      }
    },

    // ---- per-frame update -------------------------------------------------------------
    update: function (dt) {
      Dialog.update(dt);
      var st = SH.State;
      if (st.mode !== 'playing') return;

      // Briefing phase: reaching Mami at the safehouse starts the next mission.
      if (!this.active && this.phase === 'briefing') {
        var p = st.player;
        if (!st.driving && Math.hypot(p.x - SAFEHOUSE.x, p.z - SAFEHOUSE.z) < 5) {
          this.startMission(this.currentIndex);
        }
        return;
      }
      var run = this.active;
      if (!run || run.failed) return;
      var step = run.def.steps[run.stepIndex];
      if (!step) return;
      run.stepData.t += dt;
      var f = st.driving ? st.vehiclePos : st.player;

      if (step.timeLimit && run.stepData.t > step.timeLimit) {
        this.failMission('Out of time');
        return;
      }

      if (run.def.id === 'escort-mami') this.escortEvents(run, dt);
      if (run.def.id === 'double-cross') this.crossEvents(run, dt);

      switch (step.type) {
        case 'goTo': {
          var needFoot = run.def.id === 'escort-mami' && run.stepIndex === run.def.steps.length - 1;
          if (Math.hypot(f.x - step.x, f.z - step.z) < step.r && (!needFoot || !st.driving)) this.advance();
          break;
        }
        case 'enterVehicle': {
          var tv = run.stepData.targetVeh;
          if (tv) this.setObjective(run.def.title, step.text, tv.x, tv.z);
          if (st.driving && (!tv || st.vehicle === tv)) this.advance();
          break;
        }
        case 'deliver': {
          if (!st.driving) { this.failMission('You left the truck'); return; }
          if (Math.hypot(f.x - step.x, f.z - step.z) < step.r) this.advance();
          break;
        }
        case 'driveTo': {
          if (Math.hypot(f.x - step.x, f.z - step.z) < step.r) this.advance();
          break;
        }
        case 'chasePed': {
          if (this.updateCourier(dt)) {
            Dialog.play([['Courier', 'Enough! I give up — take it!', 2.6]]);
            this.advance();
          }
          break;
        }
        case 'chaseCar': {
          if (this.updateDarioCar(run, dt)) {
            Dialog.play([['Dario Latu', 'Enough! The ferry ramp — settle it like men!', 3.2]]);
            this.advance();
          }
          break;
        }
        case 'escape': {
          this.setObjective(run.def.title, step.text + ' (' + st.wanted + '★)', f.x, f.z);
          if (st.wanted <= 0) this.advance();
          break;
        }
        case 'kill': {
          if (SH.Combat.enemies.length === 0) this.advance();
          break;
        }
        case 'survive': {
          if (run.stepData.t >= (step.seconds || 30)) this.advance();
          break;
        }
      }
    },

    advance: function () {
      var run = this.active;
      if (!run) return;
      run.stepIndex++;
      if (run.stepIndex >= run.def.steps.length) this.completeMission();
      else this.beginStep();
    }
  };

  SH.Missions = Missions;
})(window.SH = window.SH || {});
