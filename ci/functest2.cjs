// Functional test 2 for SELATARA HEAT — slice G: missions 5-8 end-to-end,
// economy shops, radio stations, weather, save/load roundtrip, credits.
// Game-time aware like functest.cjs (headless SwiftShader is ~2.5 fps).
const { chromium } = require('playwright-core');

const URL = 'file://' + require('path').join(__dirname, '..', 'game', 'index.html');
const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra: extra || '' }); }

async function waitGame(page, sec, timeoutWall) {
  const t0 = await page.evaluate(() => window.SH.State.time);
  const start = Date.now();
  const limit = timeoutWall || 240000;
  while (Date.now() - start < limit) {
    const t = await page.evaluate(() => window.SH.State.time);
    if (t - t0 >= sec) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL);
  await page.waitForTimeout(2500);

  // DOM click on the same button handler: Playwright's actionability +
  // navigation waits time out on this SwiftShader VM (documented flake,
  // also seen on the pristine baseline); the handler itself is what the
  // test exercises. No assertion changes.
  await page.evaluate(() => document.querySelector('#btn-new').click());
  await waitGame(page, 0.3);
  await page.keyboard.press('Space');
  await waitGame(page, 0.4);
  check('playing after intro skip', await page.evaluate(() => window.SH.State.mode) === 'playing');

  // Keep the police fleet out of the mission-chain section (decay/busted
  // paths are covered by functest.cjs); wanted VALUES still drive steps.
  await page.evaluate(() => {
    window.SH.Config.police.carsByStars = [0, 0, 0, 0, 0, 0];
    window.SH.Police.despawnAll(false);
    window.SH.State.cash = 5000;
  });

  // ---------- Economy: gun shop ----------
  await page.evaluate(() => { const S = window.SH.State; S.player.x = -128; S.player.z = -64; });
  await waitGame(page, 0.8);
  const shop1 = await page.evaluate(() => {
    window.SH.Economy.openShop('guns', 'Senjata Senja (Gun Shop)');
    return {
      open: window.SH.State.shopOpen, kind: window.SH.State.shopKind,
      panel: !document.getElementById('shop-panel').classList.contains('hidden')
    };
  });
  check('gun shop opens', shop1.open && shop1.kind === 'guns' && shop1.panel, JSON.stringify(shop1));
  const buy1 = await page.evaluate(() => {
    const before = window.SH.State.cash;
    const ok = window.SH.Economy.buy('smg');
    return { ok, spent: before - window.SH.State.cash, owned: window.SH.Combat.owned.smg };
  });
  check('buy SMG ($1400, owned)', buy1.ok && buy1.spent === 1400 && buy1.owned, JSON.stringify(buy1));
  const buy2 = await page.evaluate(() => {
    const ok = window.SH.Economy.buy('armor');
    return { ok, armor: window.SH.State.player.armor };
  });
  check('buy armour fills to 100', buy2.ok && buy2.armor === 100, JSON.stringify(buy2));
  await page.evaluate(() => window.SH.Economy.closeShop());

  // ---------- Economy: food stall heals ----------
  await page.evaluate(() => { const S = window.SH.State; S.player.health = 40; S.player.x = -330; S.player.z = 92; });
  await waitGame(page, 0.8);
  await page.evaluate(() => window.SH.Economy.openShop('food', 'Warung Bu Tini (Food)'));
  const buy3 = await page.evaluate(() => {
    const ok = window.SH.Economy.buy('meal');
    return { ok, hp: window.SH.State.player.health, kind: window.SH.State.shopKind };
  });
  check('warung meal heals 40->85', buy3.ok && buy3.hp === 85 && buy3.kind === 'food', JSON.stringify(buy3));
  await page.evaluate(() => window.SH.Economy.closeShop());

  // ---------- Economy: safehouse rest + save ----------
  await page.evaluate(() => { const S = window.SH.State; S.player.x = -368; S.player.z = 80; });
  await waitGame(page, 0.8);
  await page.evaluate(() => window.SH.Economy.openShop('safehouse', 'Safehouse Ruko Senja'));
  const buy4 = await page.evaluate(() => {
    const ok = window.SH.Economy.buy('rest');
    return { ok, hour: window.SH.State.hour, hp: window.SH.State.player.health, kind: window.SH.State.shopKind };
  });
  check('safehouse rest sets morning + full HP', buy4.ok && buy4.hour === 8 && buy4.hp === 100 && buy4.kind === 'safehouse', JSON.stringify(buy4));
  const buy5 = await page.evaluate(() => ({ ok: window.SH.Economy.buy('save'), has: window.SH.Save.hasSave() }));
  check('safehouse manual save', buy5.ok && buy5.has, JSON.stringify(buy5));
  await page.evaluate(() => window.SH.Economy.closeShop());

  // ---------- Economy: workshop repair + spray ----------
  await page.evaluate(() => {
    const S = window.SH.State;
    const scene = window.SH.Main.getScene();
    const car = window.SH.Vehicles.spawnVehicle(scene, 'sedan', 0x4f7ac9, 246, 60, 0);
    car.hp = 35; car.driver = 'player';
    S.driving = true; S.vehicle = car; S.vehiclePos.x = 246; S.vehiclePos.z = 60;
    S.player.x = 246; S.player.z = 60;
    window.SH.Police.forceWanted(2);
  });
  await waitGame(page, 0.8);
  await page.evaluate(() => window.SH.Economy.openShop('workshop', 'Bengkel Arus (Workshop)'));
  const buy6 = await page.evaluate(() => {
    const ok = window.SH.Economy.buy('spray');
    return { ok, hp: window.SH.State.vehicle.hp, wanted: window.SH.State.wanted, kind: window.SH.State.shopKind };
  });
  check('workshop spray: repaired + wanted cleared', buy6.ok && buy6.hp === 100 && buy6.wanted === 0 && buy6.kind === 'workshop', JSON.stringify(buy6));
  await page.evaluate(() => {
    window.SH.Economy.closeShop();
    const S = window.SH.State; S.driving = false; S.vehicle = null;
  });

  // ---------- Radio: 3+ stations, K cycles, track card data ----------
  const radio = await page.evaluate(() => {
    const A = window.SH.Audio;
    const before = window.SH.State.radioStation;
    return { n: A.stations.length, before, hasCtx: !!A.ctx };
  });
  check('radio has >= 3 stations', radio.n >= 3, 'n=' + radio.n);
  if (radio.hasCtx) {
    await page.keyboard.press('KeyK');
    await waitGame(page, 0.3);
    const after = await page.evaluate(() => window.SH.State.radioStation);
    check('K cycles the station', after !== radio.before, radio.before + ' -> ' + after);
    const info = await page.evaluate(() => window.SH.Audio.trackInfo());
    check('track info has title + artist', !!(info.title && info.artist && info.station), JSON.stringify(info));
  } else {
    check('K cycles the station', false, 'no audio ctx in headless');
  }

  // ---------- Weather: rain state + particles + auto cycle ----------
  const wth = await page.evaluate(() => {
    const W = window.SH.Weather, S = window.SH.State;
    W.setWeather('rain');
    for (let i = 0; i < 4; i++) W.update(1.0); // ease the rain sheet in
    const rainOn = S.weather === 'rain' && W.rainMat.opacity > 0.3;
    W.setWeather('clear');
    W.timer = 0; W.nextIn = 0.01; W.update(0.05);
    return { rainOn, afterCycle: S.weather };
  });
  check('rain toggles on with particles', wth.rainOn, JSON.stringify(wth));
  check('weather auto-cycles', wth.afterCycle === 'rain', JSON.stringify(wth));
  await page.evaluate(() => window.SH.Weather.setWeather('clear'));

  // ---------- Mission 5: Hilltop Repo ----------
  await page.evaluate(() => window.SH.Missions.startMission(4));
  await waitGame(page, 0.3);
  await page.evaluate(() => { const S = window.SH.State; S.player.x = 330; S.player.z = -236; });
  await waitGame(page, 0.5);
  const m5a = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    const car = run ? run.stepData.targetVeh : null;
    if (car) {
      const S = window.SH.State;
      car.x = 330; car.z = -240;
      S.driving = true; S.vehicle = car; S.vehiclePos.x = car.x; S.vehiclePos.z = car.z; S.player.x = car.x; S.player.z = car.z;
    }
    return { step: run ? run.stepIndex : -1, hasCar: !!car };
  });
  check('m5: repo car targeted + entered', m5a.hasCar && m5a.step === 1, JSON.stringify(m5a));
  await waitGame(page, 0.5);
  await page.evaluate(() => {
    const S = window.SH.State;
    const car = S.vehicle; // stepData resets per step; the driven car persists on State
    if (car) { car.x = 246; car.z = 66; }
    S.vehiclePos.x = 246; S.vehiclePos.z = 66; S.player.x = 246; S.player.z = 66;
  });
  await waitGame(page, 0.5);
  const m5b = await page.evaluate(() => ({ step: window.SH.Missions.active ? window.SH.Missions.active.stepIndex : -1, wanted: window.SH.State.wanted }));
  check('m5: delivered, escape step at 2 stars', m5b.step === 3 && m5b.wanted === 2, JSON.stringify(m5b));
  await page.evaluate(() => window.SH.Police.clearWanted());
  await waitGame(page, 0.6);
  const m5c = await page.evaluate(() => ({ done: window.SH.State.stats.missionsDone, active: !!window.SH.Missions.active }));
  check('m5 completes', m5c.done === 5 && !m5c.active, JSON.stringify(m5c));
  await page.evaluate(() => { const S = window.SH.State; S.driving = false; S.vehicle = null; });

  // ---------- Mission 6: The Kencana Heist (boat getaway) ----------
  await page.evaluate(() => window.SH.Missions.startMission(5));
  await waitGame(page, 0.3);
  await page.evaluate(() => { const S = window.SH.State; S.player.x = 60; S.player.z = 210; });
  await waitGame(page, 0.5);
  await page.evaluate(() => { const S = window.SH.State; S.player.x = 60; S.player.z = 384; });
  await waitGame(page, 0.5);
  const m6a = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    const boat = run ? run.stepData.boat : null;
    if (boat) {
      const S = window.SH.State;
      S.driving = true; S.vehicle = boat; S.vehiclePos.x = boat.x; S.vehiclePos.z = boat.z; S.player.x = boat.x; S.player.z = boat.z;
    }
    return { step: run ? run.stepIndex : -1, hasBoat: !!boat, type: boat ? boat.type : null };
  });
  check('m6: boat spawned + boarded', m6a.hasBoat && m6a.type === 'boat' && m6a.step === 2, JSON.stringify(m6a));
  await waitGame(page, 0.5);
  await page.evaluate(() => {
    const S = window.SH.State;
    const boat = S.vehicle;
    if (boat) { boat.x = -420; boat.z = 330; }
    S.vehiclePos.x = -420; S.vehiclePos.z = 330; S.player.x = -420; S.player.z = 330;
  });
  await waitGame(page, 0.5);
  const m6b = await page.evaluate(() => ({ step: window.SH.Missions.active ? window.SH.Missions.active.stepIndex : -1, wanted: window.SH.State.wanted }));
  check('m6: bay crossed, escape step at 3 stars', m6b.step === 4 && m6b.wanted === 3, JSON.stringify(m6b));
  await page.evaluate(() => window.SH.Police.clearWanted());
  await waitGame(page, 0.6);
  const m6c = await page.evaluate(() => ({ done: window.SH.State.stats.missionsDone, active: !!window.SH.Missions.active }));
  check('m6 completes', m6c.done === 6 && !m6c.active, JSON.stringify(m6c));
  await page.evaluate(() => { const S = window.SH.State; S.driving = false; S.vehicle = null; S.player.x = 0; S.player.z = 0; });

  // ---------- Mission 7: Double Cross (survive + kill + escape) ----------
  await page.evaluate(() => window.SH.Missions.startMission(6));
  await waitGame(page, 0.3);
  await page.evaluate(() => { const S = window.SH.State; S.player.x = 330; S.player.z = 116; S.player.health = 100; });
  await waitGame(page, 0.5);
  const m7a = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    return { step: run ? run.stepIndex : -1, enemies: window.SH.Combat.enemies.length, wanted: window.SH.State.wanted };
  });
  check('m7: ambush wave + wanted 3 on survive', m7a.step === 1 && m7a.enemies >= 4 && m7a.wanted === 3, JSON.stringify(m7a));
  await page.evaluate(() => {
    const run = window.SH.Missions.active;
    if (run) run.stepData.t = 999; // outlast the survive timer
    window.SH.Combat.clearEnemies();
  });
  await waitGame(page, 0.6);
  const m7b = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    return { step: run ? run.stepIndex : -1, active: !!run };
  });
  check('m7: survive -> kill step reached', m7b.step === 2 || !m7b.active, JSON.stringify(m7b));
  await page.evaluate(() => window.SH.Combat.clearEnemies()); // reinforcement wave
  await waitGame(page, 0.5);
  await page.evaluate(() => window.SH.Police.clearWanted());
  await waitGame(page, 0.6);
  const m7c = await page.evaluate(() => ({ done: window.SH.State.stats.missionsDone, active: !!window.SH.Missions.active }));
  check('m7 completes', m7c.done === 7 && !m7c.active, JSON.stringify(m7c));

  // ---------- Mission 8: Last Ferry Out (chase + finale + credits) ----------
  await page.evaluate(() => window.SH.Missions.startMission(7));
  await waitGame(page, 0.3);
  await page.evaluate(() => { const S = window.SH.State; S.player.x = 60; S.player.z = 296; });
  await waitGame(page, 0.5);
  const m8a = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    return { step: run ? run.stepIndex : -1, hasCar: !!(run && run.stepData.darioCar) };
  });
  check('m8: Dario car staged for the chase', m8a.step === 1 && m8a.hasCar, JSON.stringify(m8a));
  await page.evaluate(() => { const run = window.SH.Missions.active; if (run) run.stepData.chaseT = 999; });
  await waitGame(page, 0.6);
  await page.evaluate(() => { const S = window.SH.State; S.driving = false; S.player.x = 60; S.player.z = 380; });
  await waitGame(page, 0.5);
  const m8b = await page.evaluate(() => {
    const run = window.SH.Missions.active;
    return { step: run ? run.stepIndex : -1, enemies: window.SH.Combat.enemies.length, wanted: window.SH.State.wanted };
  });
  check('m8: finale shootout at 4 stars', m8b.step === 3 && m8b.enemies >= 4 && m8b.wanted === 4, JSON.stringify(m8b));
  await page.evaluate(() => window.SH.Combat.clearEnemies());
  await waitGame(page, 0.5);
  await page.evaluate(() => window.SH.Police.clearWanted());
  await waitGame(page, 0.8);
  const m8c = await page.evaluate(() => ({
    done: window.SH.State.stats.missionsDone, active: !!window.SH.Missions.active,
    story: window.SH.State.storyComplete,
    credits: !document.getElementById('credits').classList.contains('hidden'),
    phase: window.SH.Missions.phase
  }));
  check('m8 completes the story', m8c.done === 8 && !m8c.active && m8c.story === true, JSON.stringify(m8c));
  check('credits roll after finale', m8c.credits === true, JSON.stringify(m8c));
  check('free roam after credits', m8c.phase === 'free', JSON.stringify(m8c));

  // ---------- Save/load roundtrip incl. story flag ----------
  const roundtrip = await page.evaluate(() => {
    const S = window.SH.State;
    S.cash = 7777;
    window.SH.Save.saveGame();
    S.cash = 1; S.storyComplete = false;
    const ok = window.SH.Save.loadGame();
    return { ok, cash: S.cash, story: S.storyComplete, idx: window.SH.Missions.currentIndex };
  });
  check('save/load roundtrip restores cash + story flag', roundtrip.ok && roundtrip.cash === 7777 && roundtrip.story === true, JSON.stringify(roundtrip));

  check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(JSON.stringify({ results, errorCount: errors.length, errors: errors.slice(0, 5) }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FUNCTEST2 FAILED', e); process.exit(1); });
