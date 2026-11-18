// SELATARA HEAT — missions.js
// The eight story jobs of the Arus Syndicate arc, as data. The mission runner
// (step state machine, checkpoints, dialogue playback) lands in the mission
// slice; this module owns the definitions + objective helpers the HUD reads.
// Public API: SH.Missions { list[], setObjective(title, text, x, z), clearObjective() }.
(function (SH) {
  'use strict';

  var Missions = {
    list: [
      { id: 'first-run', title: 'FIRST RUN', giver: 'Mami Ratna', reward: 400, brief: 'Deliver a package from Ruko Senja to Pantai Kencana.' },
      { id: 'night-market', title: 'NIGHT MARKET RUN', giver: 'Mami Ratna', reward: 650, brief: 'Catch the courier running through the Ruko Senja night market.' },
      { id: 'port-of-lies', title: 'PORT OF LIES', giver: 'Mami Ratna', reward: 900, brief: 'Steal a container truck from Pelabuhan Karat and lose the police.' },
      { id: 'escort-mami', title: 'ESCORT MAMI', giver: 'Mami Ratna', reward: 1200, brief: 'Drive Mami Ratna across town while rival crews try to stop her car.' },
      { id: 'hilltop-repo', title: 'HILLTOP REPO', giver: 'Bengkel Arus', reward: 1100, brief: 'Repossess a sport car from a Bukit Mawar villa, through the roadblocks.' },
      { id: 'kencana-heist', title: 'THE KENCANA HEIST', giver: 'Mami Ratna', reward: 2000, brief: 'Rob the boardwalk jewellery store and escape by boat.' },
      { id: 'double-cross', title: 'DOUBLE CROSS', giver: 'Unknown', reward: 1800, brief: 'Survive Commissioner Varga\u2019s trap in a port warehouse.' },
      { id: 'last-ferry', title: 'LAST FERRY OUT', giver: 'Mami Ratna', reward: 3000, brief: 'Chase Dario \u201CKapten\u201D Latu to the last ferry and end this.' }
    ],
    currentIndex: 0,
    active: null,

    setObjective: function (title, text, x, z) {
      SH.State.objective = { title: title, text: text, x: x, z: z };
      if (SH.HUD) SH.HUD.notify(title + ' — ' + text);
    },

    clearObjective: function () { SH.State.objective = null; },

    startIntroObjective: function () {
      this.setObjective('FIRST RUN', 'Meet Mami Ratna at the safehouse', -368, 84);
    }
  };

  SH.Missions = Missions;
})(window.SH = window.SH || {});
