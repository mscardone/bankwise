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
  // the tests start from an empty library; the real starter library is checked on its own further down
  await ctx.route('**/data/seed-library.json**', r => r.fulfill({ json: { v: 2, pw: 24, ph: 16, items: [], colours: {} } }));
  await ctx.route('**/data/wiki-icons.json**', r => r.fulfill({ status: 404, body: '' }));
  // canned wiki data
  await ctx.route('**/rs_dump.json', r => r.fulfill({ json: { '%LAST_UPDATE%': 1, 1513: { id: 1513, name: 'Magic logs', price: 412, highalch: 192, value: 320 }, 2: { id: 2, name: 'Rusty sword', price: 60, highalch: 15, value: 25 }, 3: { id: 3, name: 'Noxious scythe', price: 61000000, highalch: 300000, value: 500000 } } }));
  // a pretend wiki: 14 items whose "icons" are sprites cut out of the real capture (trimmed, transparent, a little noisy)
  const { PNG } = require('pngjs'); const loadPng = require('../tools/pngload.js'); const ReaderN = require('../src/reader.js')(null);
  const capBuf = loadPng(path.join(__dirname, 'capture-plain.png')), capRead = ReaderN.readBuffer(capBuf), sprites = {}; let seedR = 3;
  capRead.slots.forEach(sl => {
    if (Object.keys(sprites).length >= 14) return;
    for (let y = 0; y < 20; y++) for (let x = 0; x < sl.w; x++) { const q = ((sl.y + y) * capBuf.width + sl.x + x) * 4; if (capBuf.data[q] > 200 && capBuf.data[q + 1] > 200 && capBuf.data[q + 2] < 80) return; }
    const isC = (x, y) => { const q = ((sl.y + y) * capBuf.width + sl.x + x) * 4; return Math.abs(capBuf.data[q] - 51) + Math.abs(capBuf.data[q + 1] - 46) + Math.abs(capBuf.data[q + 2] - 41) > 24; };
    let x0 = 99, x1 = -1, y0 = 99, y1 = -1; for (let y = 0; y < sl.h; y++) for (let x = 0; x < sl.w; x++) if (isC(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return; const png = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) { const q = ((sl.y + y0 + y) * capBuf.width + sl.x + x0 + x) * 4, o = (y * png.width + x) * 4; for (let k = 0; k < 3; k++) { seedR = (seedR * 1103515245 + 12345) % 2147483648; png.data[o + k] = Math.max(0, Math.min(255, capBuf.data[q + k] + (seedR / 2147483648 - 0.5) * 12)); } png.data[o + 3] = isC(x0 + x, y0 + y) ? 255 : 0; }
    const name = 'Test item ' + (Object.keys(sprites).length + 1); sprites[name] = { png: PNG.sync.write(png), x: sl.x, y: sl.y };
  });
  await ctx.route('**/runescape.wiki/images/**', r => { const nm = decodeURIComponent(r.request().url().split('/images/')[1]).replace(/_/g, ' ').replace(/\.png$/, ''); const sp = sprites[nm]; if (sp) r.fulfill({ body: sp.png, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }); else r.fulfill({ status: 404, body: 'no' }); });
  await ctx.route('**/runescape.wiki/api.php**', r => {
    if (/generator=categorymembers/.test(r.request().url())) {
      const all = Object.keys(sprites), second = /gcmcontinue=/.test(r.request().url()), part = second ? all.slice(7) : all.slice(0, 7), pages = {};
      part.forEach((t, k) => { pages[100 + k + (second ? 50 : 0)] = { title: t, images: [{ title: 'File:' + t + '.png' }, { title: 'File:' + t + ' detail.png' }, { title: 'File:Coins 1000.png' }] }; });
      return r.fulfill({ json: second ? { query: { pages } } : { continue: { gcmcontinue: 'page|x', continue: 'gcmcontinue||' }, query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
    }
    const titles = decodeURIComponent((r.request().url().match(/titles=([^&]*)/) || [])[1] || '').split('|'); const pages = {}; let i = 1;
    if (/^Module:GE/.test(titles[0])) {   // the wiki's own price / alch / value tables
      const tables = { 'Module:GEPrices/data.json': { '%LAST_UPDATE%': 1, 'Magic logs': 412, 'Rusty sword': 60, 'Noxious scythe': 61000000 }, 'Module:GEHighAlchs/data.json': { 'Magic logs': 192, 'Rusty sword': 15, 'Noxious scythe': 300000 }, 'Module:GEValues/data.json': { 'Magic logs': 320 } };
      for (let k = 0; k < 120; k++) tables['Module:GEPrices/data.json']['Filler ' + k] = 5;
      titles.forEach(t => { pages[i++] = { title: t, revisions: [{ slots: { main: { '*': JSON.stringify(tables[t] || {}) } } }] }; });
      return r.fulfill({ json: { query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
    }
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
  ok('detail card shows the high alch value', /High alch\s*192/.test(card), card.replace(/\s+/g, ' '));
  const total = await page.evaluate(() => ({ shown: document.getElementById('banktotal').style.display !== 'none', text: document.getElementById('banktotal').textContent.replace(/\s+/g, ' '), t: Bankwise._bankTotal() }));
  ok('bank total is shown: "' + total.text.trim() + '"', total.shown && total.t.items === 3 && total.t.total >= 412 && /Bank total/.test(total.text), JSON.stringify(total));
  // overlay: gold stack value under the item, colour bar by the price of ONE item, all of it adjustable
  const ovNow = async () => { await page.evaluate(() => { window.__ov.length = 0; Bankwise._redraw(); }); await page.waitForTimeout(300); return page.evaluate(() => { const s = Bankwise._view().slots.filter(q => q.id.name === 'Magic logs' && q.id.state === 'known')[0], mine = o => o[2] >= s.x && o[2] < s.x + s.w && o[3] >= s.y - 2 && o[3] <= s.y + s.h + 2; return { slot: { x: s.x, y: s.y, stack: s.stack }, rects: window.__ov.filter(o => o[0] === 'rect' && o[2] >= s.x && o[2] < s.x + s.w && o[3] >= s.y && o[3] < s.y + s.h).map(o => [o[1], o[5]]), texts: window.__ov.filter(o => o[0] === 'text' && o[4] >= s.x && o[4] < s.x + s.w && o[5] >= s.y && o[5] <= s.y + s.h + 2).map(o => [o[1], o[2]]), all: window.__ov.filter(o => o[0] === 'text').map(o => o[1]), gold: A1lib.mixColor(248, 213, 107), red: A1lib.mixColor(255, 0, 0) }; }); };
  let o1 = await ovNow();
  ok('overlay writes the stack value in gold under the item (' + JSON.stringify(o1.texts.map(t => t[0])) + ', stack ' + JSON.stringify(o1.slot.stack) + '), and a 412 gp item gets no colour bar', o1.texts.some(t => t[1] === o1.gold && /^~?[0-9.]+[KMB]?$/.test(t[0])) && !o1.rects.some(r => r[1] === 2), JSON.stringify(o1));
  await page.click('#opensettings');
  await page.fill('input[data-tier="0"]', '400'); await page.dispatchEvent('input[data-tier="0"]', 'change');
  await page.fill('input[data-tiercolor="0"]', 'ff0000'); await page.dispatchEvent('input[data-tiercolor="0"]', 'change');
  let o2 = await ovNow();
  ok('cutoff lowered to 400 and colour set to #ff0000: the item gets a red bar', o2.rects.some(r => r[0] === o2.red && r[1] === 2), JSON.stringify(o2.rects));
  await page.uncheck('#ovtiers'); await page.uncheck('#ovstack'); await page.uncheck('input[data-ov="tagD"]');
  let o3 = await ovNow();
  ok('colour bars, stack values and the D letter can each be switched off', !o3.rects.some(r => r[1] === 2) && !o3.texts.length && !o3.all.includes('D') && o3.all.includes('K'), JSON.stringify(o3));
  await page.check('#ovstack'); await page.fill('#ovstackmin', '100000000'); await page.dispatchEvent('#ovstackmin', 'change');
  let o4 = await ovNow();
  ok('stack values below the chosen minimum are left out', !o4.texts.length, JSON.stringify(o4.texts));
  await page.click('#ovreset'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-overlay-settings.png'), fullPage: true });
  const back = await page.evaluate(() => Bankwise._settings.ov);
  ok('"Overlay back to defaults" restores everything', back.tiers[0].min === 1000 && back.tiers[0].color === '#4ea56a' && back.showTiers && back.showStack && back.stackMin === 0 && back.tagD, JSON.stringify(back));
  await page.click('#closesettings');
  // the card follows the mouse even with teach off
  await page.uncheck('#teach'); await page.hover('#list .item:has-text("Santa hat")');
  await page.evaluate((i) => { const s = Bankwise._view().slots[i]; window.alt1.mousePosition = ((s.x + 20) << 16) + (s.y + 20); window.__tip = ''; }, idx.logs); await page.waitForTimeout(700);
  ok('teach off: the card still shows the item under the mouse', (await page.textContent('#hname')) === 'Magic logs');
  await page.evaluate(() => { window.alt1.mousePosition = -1; }); await page.check('#teach');
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

  // wiki guesses: build the icon library from the pretend wiki, see guesses, confirm one, refuse a mismatch
  const p6 = await ctx.newPage(); const e6 = []; p6.on('pageerror', e => e6.push(e.message)); await p6.addInitScript(alt1Init);
  await p6.goto('http://127.0.0.1:8378/index.html'); await p6.evaluate(async () => { localStorage.clear(); await WikiBuild.clearLocal(); }); await p6.reload();
  await p6.evaluate(() => { window.__tip = ''; window.__realTip = window.TipReader.read; window.TipReader.read = (b, x, y) => window.__tip ? { area: { x: 0, y: 0, width: 1, height: 1 }, text: window.__tip, font: 'test' } : null; });
  await setCap(p6, 'capture-plain.png', -1); await p6.waitForTimeout(1500);
  await p6.click('#opensettings'); await p6.click('#wikibuild'); await p6.waitForTimeout(2500);
  const ws = await p6.textContent('#wikistatus'); ok('builds the icon library from the wiki category (2 pages of results, detail/other files skipped): "' + ws.trim() + '"', /^14 wiki icons/.test(ws.trim()), ws);
  await p6.click('#closesettings'); await p6.waitForTimeout(2500);
  const gs = await p6.evaluate((sprites) => { const v = Bankwise._view(); let right = 0, wrongG = 0; Object.keys(sprites).forEach(n => { const sl = v.slots.filter(q => q.x === sprites[n].x && q.y === sprites[n].y)[0]; if (sl && sl.id.state === 'guess' && (sl.id.name === n || sl.id.alts.includes(n))) right++; else wrongG++; }); return { right, wrongG, guessed: v.slots.filter(q => q.id.state === 'guess').length, counts: document.getElementById('counts').textContent }; }, Object.fromEntries(Object.entries(sprites).map(([n, v]) => [n, { x: v.x, y: v.y }])));
  ok('unknown items are guessed from the wiki icons: ' + gs.right + ' of 14 right (' + gs.counts.replace(/\s+/g, ' ').trim() + ')', gs.right >= 13, JSON.stringify(gs));
  const t1 = sprites['Test item 1'], t2 = sprites['Test item 2'];
  await p6.evaluate(([x, y]) => { window.alt1.mousePosition = ((x + 20) << 16) + (y + 22); window.__tip = 'Test item 1'; }, [t1.x, t1.y]); await p6.waitForTimeout(1300);
  await p6.evaluate(([x, y]) => { window.alt1.mousePosition = ((x + 20) << 16) + (y + 22); window.__tip = 'Test item 9'; }, [t2.x, t2.y]); await p6.waitForTimeout(1300);
  await p6.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await p6.waitForTimeout(1200);
  const after = await p6.evaluate(([a, b]) => { const v = Bankwise._view(), f = p => v.slots.filter(q => q.x === p[0] && q.y === p[1])[0].id; return { names: Bankwise._lib().names(), s1: f(a).state, s2: f(b).state + ' ' + f(b).name }; }, [[t1.x, t1.y], [t2.x, t2.y]]);
  ok('hovering a guess confirms it (' + after.s1 + '); a tooltip naming a different wiki item is refused, slot stays "' + after.s2 + '"', after.names.length === 1 && after.names[0] === 'Test item 1' && after.s1 === 'known' && /^guess Test item 2/.test(after.s2) && e6.length === 0, JSON.stringify(after) + e6.join('|'));
  await p6.screenshot({ path: path.join(__dirname, '../docs/ui-guesses.png') });
  const accText = await p6.textContent('#acceptguesses'); await p6.click('#acceptguesses'); await p6.waitForTimeout(1500);
  const acc = await p6.evaluate(() => ({ lib: Bankwise._lib().names().length, guessed: Bankwise._view().slots.filter(q => q.id.state === 'guess').length, counts: document.getElementById('counts').textContent }));
  ok('"' + accText.trim() + '" stores them in one click: ' + acc.lib + ' items in the library, ' + acc.guessed + ' guesses left; ' + (acc.counts.match(/worth about [^ ]+/) || ['no total'])[0], acc.lib >= 8 && acc.guessed < 15, JSON.stringify(acc));
  await p6.reload(); await p6.waitForTimeout(1200);
  ok('the icon library is still there after a reload', (await p6.evaluate(() => Bankwise._wiki().n)) === 14);

  // plain browser, no Alt1
  const p2 = await ctx.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.addInitScript(() => { delete window.alt1; });
  const c3 = await browser.newContext({ viewport: { width: 340, height: 520 } }); const p3 = await c3.newPage(); p3.on('pageerror', e => e2.push(e.message));
  await p3.goto('http://127.0.0.1:8378/index.html'); await p3.waitForTimeout(500);
  const seedN = await p3.evaluate(() => Bankwise._lib().names().length);
  ok('the shipped starter library loads: ' + seedN + ' items known before anything is taught', seedN > 600 && !(await p3.evaluate(() => Bankwise._lib().names().some(n => /^view tab/i.test(n)))));
  ok('outside Alt1 it says so and does not crash', /inside Alt1/.test(await p3.textContent('#status')) && e2.length === 0, e2.join(' | '));
  await browser.close(); srv.kill(); console.log(fails ? fails + ' FAILED' : 'all UI checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
