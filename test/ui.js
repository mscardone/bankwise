/* Headless browser check of the whole app with a fake Alt1 (needs: npm i -g playwright).
   Feeds the synthetic native-size capture in as the game, fakes the mouse and the game's
   tooltip, serves canned wiki answers, and checks teaching, advice, the overlay calls,
   settings and persistence.  Refreshes the screenshots in docs/.      node test/ui.js */
const { chromium } = require('playwright');
const { spawn } = require('child_process'); const path = require('path'), fs = require('fs');
(async () => {
  const srv = spawn('node', [path.join(__dirname, '../tools/serve.js'), '8378'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch(); let fails = 0; const ok = (n, c, x) => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) fails++; };
  const ctx = await browser.newContext({ viewport: { width: 340, height: 620 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  // canned wiki data
  await ctx.route('**/rs_dump.json', r => r.fulfill({ json: { '%LAST_UPDATE%': 1, 1513: { id: 1513, name: 'Magic logs', price: 412, highalch: 192, value: 320 }, 2: { id: 2, name: 'Rusty sword', price: 60, highalch: 15, value: 25 }, 3: { id: 3, name: 'Noxious scythe', price: 61000000, highalch: 300000, value: 500000 } } }));
  await ctx.route('**/runescape.wiki/api.php**', r => {
    const titles = decodeURIComponent((r.request().url().match(/titles=([^&]*)/) || [])[1] || '').split('|'); const pages = {}; let i = 1;
    titles.forEach(t => { if (/boits/i.test(t)) { pages[i++] = { title: t, missing: '' }; return; } const cats = /santa/i.test(t) ? ['Reclaimable from Diango', 'Holiday items'] : /commorb/i.test(t) ? ['Quest items', 'While Guthix Sleeps'] : /logs/i.test(t) ? ['Logs', 'Firemaking'] : ['Items']; pages[i++] = { title: t, categories: cats.map(c => ({ title: 'Category:' + c })) }; });
    r.fulfill({ json: { query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route('**/runemetrics/profile/profile**', r => r.fulfill({ json: { name: 'Tester', skillvalues: [{ id: 11, level: 99 }, { id: 9, level: 99 }, { id: 22, level: 99 }, { id: 8, level: 99 }] }, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('**/runemetrics/quests**', r => r.fulfill({ json: { quests: [{ title: 'While Guthix Sleeps', status: 'COMPLETED' }] }, headers: { 'access-control-allow-origin': '*' } }));
  const alt1Init = () => {
    window.__ov = []; const rec = n => (...a) => { window.__ov.push([n, ...a]); return true; };
    window.alt1 = { permissionPixel: true, permissionOverlay: true, permissionGameState: true, rsLinked: true, rsWidth: 2560, rsHeight: 1351, mousePosition: -1, identifyAppUrl() { },
      overLaySetGroup: rec('group'), overLayFreezeGroup: rec('freeze'), overLayClearGroup: rec('clear'), overLayRefreshGroup: rec('refresh'), overLayRect: rec('rect'), overLayLine: rec('line'), overLayTextEx: rec('text'), overLayText: rec('text') };
  };
  await page.addInitScript(alt1Init);
  await page.goto('http://127.0.0.1:8378/index.html');
  const b64 = fs.readFileSync(path.join(__dirname, 'synth-native-main.png')).toString('base64');
  await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height); const id = new A1lib.ImageData(cv.width, cv.height); id.data.set(d.data);
    window.__ref = new A1lib.ImgRefData(id, 0, 0); Reader._capture = () => window.__ref;
    // the game's tooltip: whatever the test says the hovered item is called
    window.__tip = '';
    window.TipReader.read = () => window.__tip ? { area: { x: 0, y: 0, width: 1, height: 1 }, text: window.__tip, font: 'test' } : null;
  }, b64);
  await page.waitForTimeout(1700);
  let v = await page.evaluate(() => ({ n: Bankwise._view() && Bankwise._view().slots.length, pitch: Bankwise._view() && Bankwise._view().grid.pitch, status: document.getElementById('status').textContent }));
  ok('finds the bank in a full-size capture: ' + v.n + ' items, pitch ' + v.pitch, v.n > 150 && v.pitch === 44, JSON.stringify(v));
  let ov = await page.evaluate(() => window.__ov.filter(o => o[0] === 'rect').length);
  ok('every item starts boxed for teaching (' + ov + ' rectangles)', ov >= v.n, ov);
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-first-run.png') });

  // hover three items, the "game" names them
  const hover = async (i, tip) => { await page.evaluate(([i, tip]) => { const s = Bankwise._view().slots[i]; window.alt1.mousePosition = ((s.x + 20) << 16) + (s.y + 20); window.__tip = tip; }, [i, tip]); await page.waitForTimeout(900); };
  const idx = await page.evaluate(() => { const s = Bankwise._view().slots, last = Math.max(...s.map(q => q.section)); const t4 = s.filter(q => q.section === last); const at = (r, c) => s.indexOf(t4.filter(q => q.col === c)[r]); return { logs: at(1, 9), a: at(0, 1), b: at(0, 3) }; });
  await hover(idx.logs, 'Magic logs');
  await hover(idx.a, 'Santa hat');
  await hover(idx.b, 'Commorb');
  await hover(idx.b, 'Commorb');
  await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(1500);
  const names = await page.evaluate(() => Bankwise._lib().names());
  ok('learns items from the tooltip: ' + names.join(', '), names.length === 3 && names.includes('Magic logs') && names.includes('Santa hat'), JSON.stringify(names));
  const list = await page.$$eval('#list .item .nm', els => els.map(e => e.textContent.trim()).filter(t => !/hover it/.test(t)));
  ok('known items listed with advice: ' + list.join(' | '), list.some(t => /destroy\s+Santa hat/.test(t)) && list.some(t => /Magic logs/.test(t)), list.join('|'));
  ov = await page.evaluate(() => window.__ov.slice(-400));
  ok('overlay tags the Diango item with D and the quest item with K', ov.some(o => o[0] === 'text' && o[1] === 'D') && ov.some(o => o[0] === 'text' && o[1] === 'K'), JSON.stringify(ov.filter(o => o[0] === 'text').slice(-5)));
  await page.hover('#list .item:has-text("Magic logs")');
  const card = await page.textContent('#hover');
  ok('detail card: price, tab and reason for Magic logs', /412/.test(card) && /tab 4/.test(card) && /Consumable supply/.test(card), card.replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-learned.png') });

  // the font reader's l/i slip is put right from the wiki
  const bidx = await page.evaluate(() => { const s = Bankwise._view().slots; return s.findIndex(q => q.id.state === 'unknown'); });
  await hover(bidx, 'Diamond boits'); await hover(bidx, 'Diamond boits');
  await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(1200);
  const fixedNames = await page.evaluate(() => Bankwise._lib().names());
  ok('"Diamond boits" is corrected to the wiki\'s spelling: ' + fixedNames.join(', '), fixedNames.includes('Diamond bolts') && !fixedNames.includes('Diamond boits'), JSON.stringify(fixedNames));

  // personal options are off by default, and work when switched on
  await page.click('#opensettings');
  ok('personal options start switched off', !(await page.isChecked('#usequests')) && !(await page.isChecked('#useskills')) && !(await page.isChecked('#useoverrides')));
  await page.check('#usequests'); await page.check('#useskills'); await page.check('#useoverrides');
  await page.fill('#rmuser', 'Tester'); await page.click('#rmfetch'); await page.waitForTimeout(800);
  const rm = await page.textContent('#rmstatus'); ok('RuneMetrics lookup by username: "' + rm.trim() + '"', /skill levels and 1 quests/.test(rm), rm);
  await page.selectOption('#template', 'granular');
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-settings.png') });
  await page.click('#closesettings'); await page.waitForTimeout(900);
  await page.hover('#list .item:has-text("Commorb")');
  let c2 = await page.textContent('#hverdict'); ok('quest log on: finished quest -> item can go', /While Guthix Sleeps, which you have finished/.test(c2), c2);
  await page.hover('#list .item:has-text("Magic logs")');
  c2 = await page.textContent('#hover'); ok('skill levels on: logs at 99 Firemaking/Fletching -> sell; granular template -> tab 9', /already at your goal of 99/.test(c2) && /tab 9/.test(c2), c2.replace(/\s+/g, ' '));
  await page.click('#hpins button[data-pin="keep"]'); await page.waitForTimeout(300);
  c2 = await page.textContent('#hverdict'); ok('pin as always keep wins', /You pinned this as always keep/.test(c2), c2);

  await page.reload(); await page.waitForTimeout(400);
  const kept = await page.evaluate(() => ({ lib: Bankwise._lib().names().length, s: Bankwise._settings }));
  ok('library and settings survive a reload', kept.lib === 4 && kept.s.useQuests && kept.s.template === 'granular', JSON.stringify(kept));
  ok('no page errors', errs.length === 0, errs.join(' | '));

  // the real thing: Scott's Alt1 capture with the game's tooltip showing, read by the real tooltip reader
  const p4 = await ctx.newPage(); const e4 = []; p4.on('pageerror', e => e4.push(e.message)); await p4.addInitScript(alt1Init);
  await p4.goto('http://127.0.0.1:8378/index.html');
  await p4.evaluate(() => { localStorage.clear(); }); await p4.reload();
  const hb64 = fs.readFileSync(path.join(__dirname, 'capture-hover.png')).toString('base64');
  await p4.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height); const id = new A1lib.ImageData(cv.width, cv.height); id.data.set(d.data);
    window.__ref = new A1lib.ImgRefData(id, 0, 0); Reader._capture = () => window.__ref; Reader.reset();
    window.alt1.mousePosition = (705 << 16) + 342;
  }, hb64);
  await p4.waitForTimeout(2500);
  const learned = await p4.evaluate(() => Bankwise._lib().names());
  ok('real capture + real tooltip reader in the browser: learned ' + JSON.stringify(learned), learned.length === 1 && learned[0] === 'Fremennik blade' && e4.length === 0, e4.join(' | '));
  await p4.screenshot({ path: path.join(__dirname, '../docs/ui-real-hover.png') });

  // Scott's complaint: nothing learned while the mouse stays on the item.  Plain capture first, then the hover one.
  const p5 = await ctx.newPage(); const e5 = []; p5.on('pageerror', e => e5.push(e.message)); await p5.addInitScript(alt1Init);
  await p5.goto('http://127.0.0.1:8378/index.html'); await p5.evaluate(() => { localStorage.clear(); }); await p5.reload();
  const setCap = async (pg, file, mouse) => pg.evaluate(async ([b64, mouse]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height); const id = new A1lib.ImageData(cv.width, cv.height); id.data.set(d.data);
    window.__ref = new A1lib.ImgRefData(id, 0, 0); Reader._capture = () => window.__ref; window.alt1.mousePosition = mouse;
  }, [fs.readFileSync(path.join(__dirname, file)).toString('base64'), mouse]);
  await setCap(p5, 'capture-plain.png', -1); await p5.waitForTimeout(1600);
  await setCap(p5, 'capture-hover-white.png', (694 << 16) + 540); await p5.waitForTimeout(2600);
  const st = await p5.evaluate(() => { const v = Bankwise._view(); const s = v && v.slots.filter(q => 694 >= q.x && 694 < q.x + q.w && 540 >= q.y && 540 < q.y + q.h)[0]; return { names: Bankwise._lib().names(), hovered: s && s.id, n: v && v.slots.length, card: document.getElementById('hname').textContent, status: document.getElementById('status').textContent }; });
  ok('mouse kept on a free-to-play item: learned ' + JSON.stringify(st.names) + ', card says "' + st.card + '", ' + st.n + ' items still on screen', st.names.length === 1 && st.names[0] === 'Nature rune' && st.hovered && st.hovered.state === 'known' && st.card === 'Nature rune' && st.n === 193 && e5.length === 0, JSON.stringify(st) + e5.join('|'));
  await p5.uncheck('#teach'); await p5.evaluate(() => { Bankwise._lib().forget('Nature rune'); }); await p5.waitForTimeout(1500);
  ok('teach switched off: hovering learns nothing', (await p5.evaluate(() => Bankwise._lib().names().length)) === 0);

  // plain browser, no Alt1
  const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.addInitScript(() => { delete window.alt1; });
  const c3 = await browser.newContext({ viewport: { width: 340, height: 520 } }); const p3 = await c3.newPage(); p3.on('pageerror', e => e2.push(e.message));
  await p3.goto('http://127.0.0.1:8378/index.html'); await p3.waitForTimeout(500);
  ok('outside Alt1 it says so and does not crash', /inside Alt1/.test(await p3.textContent('#status')) && e2.length === 0, e2.join(' | '));
  await browser.close(); srv.kill(); console.log(fails ? fails + ' FAILED' : 'all UI checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
