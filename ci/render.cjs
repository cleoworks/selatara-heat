// CI render runner for SELATARA HEAT (GitHub Actions / Kaggle) — mirrors the
// local devshot.cjs
// behaviour (viewport 1280x720, wall-clock staging waits, console-error
// capture, SH.State info readout) but parameterised and timed per phase.
// Usage: node render.cjs <gameIndexHtml> <outDir> <shot1,shot2,...> [waitMs]
// Writes <outDir>/shot-<name>.png and <outDir>/render-results.json.
// CPU-only by design: SwiftShader GL flags, same as the local tooling.
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const gamePath = process.argv[2];
  const outDir = process.argv[3];
  const shots = (process.argv[4] || 'cover,lake').split(',');
  const waitMs = parseInt(process.argv[5] || '9000', 10);
  fs.mkdirSync(outDir, { recursive: true });
  const results = {
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
    shots: []
  };
  const tLaunch = Date.now();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  results.launchMs = Date.now() - tLaunch;

  // WebGL renderer probe (proves which GL backend actually ran).
  {
    const page = await browser.newPage();
    await page.goto('about:blank');
    results.webgl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return { ok: false };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        ok: true,
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
      };
    });
    await page.close();
  }

  for (const name of shots) {
    const t0 = Date.now();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const url = 'file://' + gamePath + '?shot=' + name;
    const tGoto = Date.now();
    await page.goto(url);
    const gotoMs = Date.now() - tGoto;
    await page.waitForTimeout(2500);
    // FPS probe: count rAF over 2 s of wall time (local SwiftShader VM ~2.5).
    const fps = await page.evaluate(() => new Promise((res) => {
      let n = 0; const start = performance.now();
      function f() { n++; if (performance.now() - start < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - start) / 1000)); }
      requestAnimationFrame(f);
    }));
    await page.waitForTimeout(Math.max(0, waitMs - 4500));
    const info = await page.evaluate(() => {
      const S = window.SH && window.SH.State;
      if (!S) return null;
      const cam = window.SH.Main.getCamera();
      return {
        mode: S.mode, hour: +S.hour.toFixed(2),
        player: [Math.round(S.player.x), Math.round(S.player.z)],
        driving: S.driving, wanted: S.wanted,
        cam: cam ? [Math.round(cam.position.x), +cam.position.y.toFixed(1), Math.round(cam.position.z)] : null,
        shotReport: window.SH.Shots ? window.SH.Shots.report : null,
        nodes: window.SH.World.graph.nodes.length,
        edges: window.SH.World.graph.edges.length,
        colliders: window.SH.World.colliders.length
      };
    });
    const out = path.join(outDir, 'shot-' + name + '.png');
    const tShot = Date.now();
    await page.screenshot({ path: out, timeout: 180000 });
    const screenshotMs = Date.now() - tShot;
    results.shots.push({
      name, gotoMs, fps: +fps.toFixed(1), screenshotMs,
      totalMs: Date.now() - t0,
      errorCount: errors.length, errors: errors.slice(0, 5),
      info, bytes: fs.statSync(out).size
    });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'render-results.json'), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
  console.log('RENDER_DONE');
})().catch((e) => { console.error('RENDER FAILED', e); process.exit(1); });
