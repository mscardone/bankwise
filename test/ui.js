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
    const url = r.request().url(), cors = { 'access-control-allow-origin': '*' };
    if (/cmtitle=Category(:|%3A)Quests/.test(url)) { const m = [{ title: 'Quests' }, { title: 'List of quests' }, { title: 'While Guthix Sleeps' }, { title: 'Holy Grail' }, { title: 'Nature Spirit' }]; for (let k = 0; k < 60; k++) m.push({ title: 'Filler quest ' + k }); return r.fulfill({ json: { query: { categorymembers: m } }, headers: cors }); }
    const titles = decodeURIComponent((url.match(/titles=([^&]*)/) || [])[1] || '').split('|'); const pages = {}; let i = 1;
    if (/prop=links/.test(url)) { titles.forEach(t => { pages[i++] = { title: t, links: /excalibur/i.test(t) ? [{ title: 'Holy Grail' }, { title: 'Sword' }, { title: 'Quests' }] : [{ title: 'Quests' }, { title: 'List of quests' }], linkshere: /silver sickle/i.test(t) ? [{ title: 'Nature Spirit/Quick guide' }, { title: 'Morytania' }] : [] }; }); return r.fulfill({ json: { query: { pages } }, headers: cors }); }
    if (/rvprop=content/.test(url) && !/^Module:GE/.test(titles[0])) {   // item pages as wikitext: the combat-stats box
      titles.forEach(t => { pages[i++] = { title: t, revisions: [{ slots: { main: { '*': /desert disguise/i.test(t) ? "{{Infobox Bonuses\n|class = none\n|slot = head\n|tier = \n}}" : /^mask of sliske$/i.test(t) ? "'''Mask of Sliske''' may refer to:\n* The [[Mask of Sliske, Light]], a reward\n* [[Mask of Sliske, Shadow]]\n{{Disambig}}" : /rune scimitar/i.test(t) ? "{{Infobox Bonuses\n|class = melee\n|slot = main hand weapon\n|tier = 50\n}}" : /noxious/i.test(t) ? "{{Infobox Bonuses\n|class=melee\n|slot=2h\n|tier=90\n|damage=1500\n}}" : /commorb/i.test(t) ? "{{Infobox Item\n|value = 100\n|alchable = yes\n}}" : 'no stats here' } } }] }; });
      return r.fulfill({ json: { query: { pages } }, headers: cors });
    }
    if (/^Module:GE/.test(titles[0])) {   // the wiki's own price / alch / value tables
      const tables = { 'Module:GEPrices/data.json': { '%LAST_UPDATE%': 1, 'Magic logs': 412, 'Rusty sword': 60, 'Rune scimitar': 5200, 'Noxious scythe': 61000000 }, 'Module:GEHighAlchs/data.json': { 'Magic logs': 192, 'Rusty sword': 15, 'Noxious scythe': 300000 }, 'Module:GEValues/data.json': { 'Magic logs': 320 } };
      for (let k = 0; k < 120; k++) tables['Module:GEPrices/data.json']['Filler ' + k] = 5;
      titles.forEach(t => { pages[i++] = { title: t, revisions: [{ slots: { main: { '*': JSON.stringify(tables[t] || {}) } } }] }; });
      return r.fulfill({ json: { query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
    }
    titles.forEach(t => { if (/boits/i.test(t)) { pages[i++] = { title: t, missing: '' }; return; } const cats = /santa/i.test(t) ? ['Reclaimable from Diango', 'Holiday items'] : /commorb/i.test(t) ? ['Quest items', 'While Guthix Sleeps'] : /excalibur/i.test(t) ? ['Quest rewards', 'Items'] : /logs/i.test(t) ? ['Logs', 'Firemaking'] : ['Items']; pages[i++] = { title: t, categories: cats.map(c => ({ title: 'Category:' + c })), extract: /^mask of sliske$/i.test(t) ? 'Mask of Sliske may refer to:' : /desert disguise/i.test(t) ? 'The desert disguise is an item which can be worn in head slot. The disguise is used in The Feud quest. Regardless of quest progress, it can still be created.' : t + ' is an item in the pretend wiki. It is used for testing the detail card. ' + 'This opening paragraph goes on for a good while so that it cannot fit. '.repeat(8) + 'Last sentence of the intro.' }; });
    r.fulfill({ json: { query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
  });
  // the Cloudflare Worker: this player's RuneMetrics profile is private, so levels come from the hiscores table
  await ctx.route('**/dailyscape-proxy.scott-cardone.workers.dev/**', r => {
    const u = r.request().url(), cors = { 'access-control-allow-origin': '*' };
    if (/\/profile\?/.test(u)) return r.fulfill({ json: { error: 'PROFILE_PRIVATE', loggedIn: 'false' }, headers: cors });
    if (/\/quests\?/.test(u)) return r.fulfill({ json: { quests: [{ title: 'While Guthix Sleeps', status: 'COMPLETED' }] }, headers: cors });
    const lv = new Array(30).fill(1); lv[0] = 2000; lv[1] = 72; [11, 9, 22, 8].forEach(id => { lv[id + 1] = 99; });
    return r.fulfill({ body: lv.map((l, k) => (1000 + k) + ',' + l + ',' + (l * 1000)).join('\n') + '\n-1,-1\n', headers: Object.assign({ 'content-type': 'text/plain' }, cors) });
  });
  await ctx.route('**/runemetrics/profile/profile**', r => r.fulfill({ json: { name: 'Tester', skillvalues: [{ id: 0, level: 72 }, { id: 11, level: 99 }, { id: 9, level: 99 }, { id: 22, level: 99 }, { id: 8, level: 99 }] }, headers: { 'access-control-allow-origin': '*' } }));
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
  ok('known items listed with advice: ' + list.join(' | '), list.some(t => /Diango\s+Santa hat/.test(t)) && list.some(t => /Magic logs/.test(t)), list.join('|'));
  ov = await page.evaluate(() => window.__ov.slice(-400));
  ok('overlay tags the Diango item with D and the quest item with K', ov.some(o => o[0] === 'text' && o[1] === 'D') && ov.some(o => o[0] === 'text' && o[1] === 'K'), JSON.stringify(ov.filter(o => o[0] === 'text').slice(-5)));
  await page.hover('#list .item:has-text("Magic logs")');
  const card = await page.textContent('#hover');
  ok('detail card: price, tab and reason for Magic logs', /412/.test(card) && /tab 4/.test(card) && /Consumable supply/.test(card), card.replace(/\s+/g, ' '));
  ok('detail card shows the high alch value', /High alch\s*192/.test(card), card.replace(/\s+/g, ' '));
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

  // 0.8.2: wiki text and links on the card, quests an item is needed for, quest rewards as keepsakes, the new list buttons
  const free = async n => page.evaluate((n) => Bankwise._view().slots.map((q, i) => q.id.state === 'unknown' ? i : -1).filter(i => i >= 0)[n], n);
  for (const nm of ['Excalibur', 'Rune scimitar', 'Noxious scythe', 'Deathwarden hood']) { const at = await free(0); await hover(at, nm); await hover(at, nm); }
  await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(2500);
  await page.hover('#list .item:has-text("Commorb")'); await page.waitForTimeout(1200); await page.hover('#list .item:has-text("Commorb")');
  let cq = await page.evaluate(() => ({ blurb: document.getElementById('hblurb').textContent, quests: document.getElementById('hquests').innerHTML, wiki: document.getElementById('hwiki').getAttribute('data-url'), shown: document.getElementById('hwiki').style.display !== 'none' }));
  const clamp = await page.evaluate(() => { const el = document.getElementById('hblurb'), cs = getComputedStyle(el); return { h: el.clientHeight, full: el.scrollHeight, lines: cs.webkitLineClamp, text: el.textContent.length }; });
  ok('card: the whole wiki intro is kept (' + clamp.text + ' chars) and shown as five lines ending in an ellipsis', clamp.lines === '5' && clamp.h <= 90 && clamp.full > clamp.h && clamp.text > 400, JSON.stringify(clamp));
  ok('card: two sentences from the wiki and a link to the item page', /is used for testing/.test(cq.blurb) && cq.shown && cq.wiki === 'https://runescape.wiki/w/Commorb', JSON.stringify(cq));
  ok('quest item: the card lists the quest with a link to its wiki page', /Needed for:/.test(cq.quests) && /data-url="https:\/\/runescape\.wiki\/w\/While_Guthix_Sleeps"/.test(cq.quests), cq.quests);
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-card.png') });
  await page.evaluate(() => { window.__opened = []; window.alt1.openBrowser = u => { window.__opened.push(u); return true; }; }); await page.click('#hquests a'); await page.click('#hwiki');
  ok('links open in the player\'s browser through Alt1', JSON.stringify(await page.evaluate(() => window.__opened)) === JSON.stringify(['https://runescape.wiki/w/While_Guthix_Sleeps', 'https://runescape.wiki/w/Commorb']));
  await page.hover('#list .item:has-text("Excalibur")'); await page.waitForTimeout(1500); await page.hover('#list .item:has-text("Excalibur")');
  cq = await page.evaluate(() => ({ v: document.getElementById('hverdict').textContent, tab: document.getElementById('htab').textContent, quests: document.getElementById('hquests').textContent }));
  ok('a quest reward that cannot be reclaimed is a keepsake, marked keep, with its quest found from the page links: ' + cq.quests.trim(), /^keep/.test(cq.v) && /cannot be reclaimed/.test(cq.v) && /tab 5/.test(cq.tab) && /Holy Grail/.test(cq.quests) && !/Quests/.test(cq.quests), JSON.stringify(cq));
  { const at = await free(0); await hover(at, 'Mask of Sliske'); await hover(at, 'Mask of Sliske'); await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(2500);
    await page.hover('#list .item:has-text("Mask of Sliske")'); await page.waitForTimeout(400); await page.hover('#list .item:has-text("Magic logs")'); await page.hover('#list .item:has-text("Mask of Sliske")');
    const dis = await page.evaluate(() => ({ blurb: document.getElementById('hblurb').textContent, wiki: document.getElementById('hwiki').getAttribute('data-url') }));
    ok('a name that lands on a "may refer to" page is described by the first page on that list', /^Mask of Sliske, Light is an item/.test(dis.blurb) && dis.wiki === 'https://runescape.wiki/w/Mask_of_Sliske,_Light', JSON.stringify(dis)); }
  { const at = await free(0); await hover(at, 'Desert disguise'); await hover(at, 'Desert disguise'); await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(2500);
    await page.hover('#list .item:has-text("Desert disguise")'); await page.waitForTimeout(1500); await page.hover('#list .item:has-text("Magic logs")'); await page.hover('#list .item:has-text("Desert disguise")');
    const dd = await page.evaluate(() => ({ stats: document.getElementById('hstats').textContent, v: document.getElementById('hverdict').textContent, tab: document.getElementById('htab').textContent }));
    ok('an untradeable item the wiki text ties to a quest is a quest item, and "class none" reads as plain words: ' + dd.stats, /^Head slot/.test(dd.stats) && !/none/i.test(dd.stats) && /Quest item/.test(dd.v) && /Quest items/.test(dd.tab), JSON.stringify(dd)); }
  { const at = await free(0); await hover(at, 'Silver sickle (b)'); await hover(at, 'Silver sickle (b)'); await page.evaluate(() => { window.alt1.mousePosition = -1; window.__tip = ''; }); await page.waitForTimeout(3000);
    await page.hover('#list .item:has-text("Magic logs")'); await page.hover('#list .item:has-text("Silver sickle")'); await page.waitForTimeout(300);
    const ss = await page.evaluate(() => ({ q: document.getElementById('hquests').textContent, tab: document.getElementById('htab').textContent, v: document.getElementById('hverdict').textContent }));
    ok('an item that only the QUEST page links to (Silver sickle (b) <- Nature Spirit quick guide) is a quest item: ' + ss.q.trim(), /Needed for: Nature Spirit/.test(ss.q) && /Quest items/.test(ss.tab) && /^keep/.test(ss.v), JSON.stringify(ss)); }
  const btns = await page.$$eval('#filters button[data-f]', els => els.map(e => e.textContent.trim()));
  await page.click('#filters button[data-f="valuable"]');
  const val = await page.$$eval('#list .item .nm', els => els.map(e => e.textContent.trim()));
  await page.click('#filters button[data-f="sell"]');
  const sellL = await page.$$eval('#list .item .nm', els => els.map(e => e.textContent.trim()));
  await page.click('#filters button[data-f="all"]');
  ok('list buttons are ' + btns.join(' / ') + '; Valuable = priced items, dearest first: ' + val.join(' | '), btns.join('|') === 'All|To teach|Sell|Valuable' && /Noxious scythe/.test(val[0]) && /Rune scimitar/.test(val[1]) && val.length === 3 && !sellL.some(t => /Santa hat/.test(t)), JSON.stringify({ btns, val, sellL }));

  // personal options are off by default, and work when switched on
  await page.click('#opensettings');
  ok('personal options start switched off', !(await page.isChecked('#usequests')) && !(await page.isChecked('#useskills')) && !(await page.isChecked('#useoverrides')));
  await page.check('#usequests'); await page.check('#useskills'); await page.check('#useoverrides');
  await page.fill('#rmuser', 'Tester'); await page.click('#rmfetch'); await page.waitForTimeout(800);
  const rm = await page.textContent('#rmstatus'); ok('lookup by username through the worker (private profile -> hiscores levels): "' + rm.trim() + '"', /skill levels and 1 quests/.test(rm), rm);
  await page.selectOption('#template', 'granular');
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-settings.png') });
  await page.click('#closesettings'); await page.waitForTimeout(900);
  await page.hover('#list .item:has-text("Commorb")');
  await page.waitForTimeout(1500); await page.hover('#list .item:has-text("Magic logs")'); await page.hover('#list .item:has-text("Commorb")');
  let c2 = await page.textContent('#hverdict'); ok('quest log on: finished quest -> item can go, and it is high alched rather than destroyed', /^high alch/.test(c2) && /While Guthix Sleeps, which you have finished/.test(c2) && /High alch it for 60/.test(c2), c2);
  await page.hover('#list .item:has-text("Magic logs")');
  c2 = await page.textContent('#hover'); ok('skill levels on: logs at 99 Firemaking/Fletching -> sell; granular template -> tab 9', /already at your goal of 99/.test(c2) && /tab 9/.test(c2), c2.replace(/\s+/g, ' '));
  await page.hover('#list .item:has-text("Rune scimitar")'); await page.waitForTimeout(1500); await page.hover('#list .item:has-text("Rune scimitar")');
  c2 = await page.textContent('#hverdict'); ok('skill levels on: tier 50 weapon with 72 Attack -> sell', /^sell/.test(c2) && /Tier 50 melee weapon/.test(c2) && /Attack level of 72 lets you use tier 70/.test(c2), c2);
  await page.hover('#list .item:has-text("Noxious scythe")'); await page.waitForTimeout(1200); await page.hover('#list .item:has-text("Noxious scythe")');
  c2 = await page.textContent('#hverdict'); const st2 = await page.textContent('#hstats'); ok('a tier 90 weapon is kept, and the card gives its style and stats: ' + st2.trim(), /^keep/.test(c2) && /Melee 2h/.test(st2) && /tier 90/.test(st2) && /damage 1500/.test(st2), c2 + ' | ' + st2);
  await page.hover('#list .item:has-text("Deathwarden hood")');
  c2 = await page.textContent('#hverdict'); ok('Deathwarden gear is always keep and the card says upgradeable', /^keep\s*upgradeable/.test(c2) && /upgraded rather than replaced/.test(c2), c2);
  await page.hover('#list .item:has-text("Magic logs")');
  await page.selectOption('#tabpick', '1'); await page.waitForTimeout(400); await page.hover('#list .item:has-text("Commorb")'); await page.hover('#list .item:has-text("Magic logs")');
  const tp = await page.evaluate(() => ({ tab: document.getElementById('htab').textContent, row: Array.from(document.querySelectorAll('#list .item')).filter(e => /Magic logs/.test(e.textContent))[0].textContent, rep: Bankwise._corrections() }));
  ok('tab picked by hand on the card: card and list follow it, and the export says what the app thought: ' + JSON.stringify(tp.rep.corrections[0] && { name: tp.rep.corrections[0].name, your: tp.rep.corrections[0].yourTab, app: tp.rep.corrections[0].appTab, kind: tp.rep.corrections[0].appKind }), /tab 2/.test(tp.tab) && /your choice; the app said tab 9/.test(tp.tab) && /tab 2/.test(tp.row) && tp.rep.corrections.length === 1 && tp.rep.corrections[0].name === 'Magic logs' && tp.rep.corrections[0].yourTab === 2 && tp.rep.corrections[0].appTab === 9 && tp.rep.corrections[0].appKind === 'wood' && Array.isArray(tp.rep.corrections[0].wikiCategories), JSON.stringify(tp).slice(0, 600));
  await page.selectOption('#tabpick', ''); await page.waitForTimeout(300);
  ok('"app\'s choice" clears the correction', (await page.evaluate(() => Bankwise._corrections().corrections.length)) === 0 && /tab 9/.test(await page.textContent('#htab')));
  await page.click('#hpins button[data-pin="keep"]'); await page.waitForTimeout(300);
  c2 = await page.textContent('#hverdict'); ok('pin as always keep wins', /You pinned this as always keep/.test(c2), c2);
  // best gear, from what has been seen in the bank; with skill levels on, only what can be worn
  await page.click('#bestgear'); await page.waitForTimeout(600);
  let gp = await page.evaluate(() => ({ open: document.getElementById('gearpanel').style.display !== 'none', listHidden: document.getElementById('list').style.display === 'none', text: document.getElementById('gearrows').textContent.replace(/\s+/g, ' ') }));
  ok('Best gear (melee), 72 Attack: wears the rune scimitar, and says the noxious scythe is better but needs 90 Attack', gp.open && gp.listHidden && /Main hand\s*Rune scimitar tier 50/.test(gp.text) && /not wearable yet: Noxious scythe \(tier 90\) - needs 90 Attack/.test(gp.text) && /Limited to what your levels/.test(gp.text), JSON.stringify(gp));
  await page.screenshot({ path: path.join(__dirname, '../docs/ui-best-gear.png') });
  await page.click('#gearstyles button[data-style="magic"]'); await page.waitForTimeout(300);
  gp = await page.evaluate(() => document.getElementById('gearrows').textContent.replace(/\s+/g, ' '));
  ok('Best gear switches style: no melee weapons under Magic', !/Rune scimitar|Noxious/.test(gp) && /nothing seen in the bank/.test(gp), gp);
  await page.click('#filters button[data-f="all"]');
  ok('a list button closes the gear panel', await page.evaluate(() => document.getElementById('gearpanel').style.display === 'none' && document.getElementById('list').style.display !== 'none'));
  // the bank closes: the overlay goes at once (a frozen overlay group only changes when refreshed)
  await page.evaluate(() => { window.__bankRef = window.__ref; const w = window.__ref.width || 2560, h = window.__ref.height || 1351; const id = new A1lib.ImageData(w, h); for (let q = 0; q < id.data.length; q += 4) { id.data[q] = 60; id.data[q + 1] = 120 + (q % 97); id.data[q + 2] = 40; id.data[q + 3] = 255; } window.__ref = new A1lib.ImgRefData(id, 0, 0); window.__ov.length = 0; });
  await page.waitForTimeout(1700);
  const closed = await page.evaluate(() => { const ops = window.__ov.map(o => o[0]), c = ops.lastIndexOf('clear'); return { status: document.getElementById('status').textContent, clearThenRefresh: c >= 0 && ops[c + 1] === 'refresh', drawnAfter: ops.slice(c + 1).filter(o => o === 'rect' || o === 'text').length }; });
  ok('bank closed: overlay cleared and refreshed within two reads, nothing drawn after: "' + closed.status + '"', /Open your bank/.test(closed.status) && closed.clearThenRefresh && closed.drawnAfter === 0, JSON.stringify(closed));
  await page.evaluate(() => { window.__ref = window.__bankRef; }); await page.waitForTimeout(1600);

  await page.reload(); await page.waitForTimeout(400);
  const kept = await page.evaluate(() => ({ lib: Bankwise._lib().names().length, s: Bankwise._settings }));
  ok('library and settings survive a reload', kept.lib === 11 && kept.s.useQuests && kept.s.template === 'granular', JSON.stringify(kept));
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
  // the shipped wiki icon sheet must unpack to exactly the bytes that were packed
  await p3.waitForFunction(() => Bankwise._wiki().n > 0, null, { timeout: 30000 }).catch(() => { });
  const fnv = b => { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  const shipped = await p3.evaluate(() => { const w = Bankwise._wiki(); let h = 2166136261; for (let i = 0; i < w.patches.length; i++) { h ^= w.patches[i]; h = Math.imul(h, 16777619) >>> 0; } return { n: w.n, bytes: w.patches.length, h }; });
  const sheet = PNG.sync.read(fs.readFileSync(path.join(__dirname, '../data/wiki-icons.png'))), metaN = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/wiki-icons.json'), 'utf8')).names.length, want = new Uint8Array(metaN * 648);
  for (let i = 0; i < metaN; i++) { const ox = (i % 128) * 18, oy = Math.floor(i / 128) * 12; for (let y = 0; y < 12; y++) for (let x = 0; x < 18; x++) { const q = ((oy + y) * sheet.width + ox + x) * 4, t = i * 648 + (y * 18 + x) * 3; want[t] = sheet.data[q]; want[t + 1] = sheet.data[q + 1]; want[t + 2] = sheet.data[q + 2]; } }
  ok('the shipped wiki icons load from the PNG sheet, byte for byte: ' + shipped.n + ' icons', shipped.n === metaN && metaN > 30000 && shipped.h === fnv(want), JSON.stringify(shipped));
  const rt = await p3.evaluate(async () => { const w = Bankwise._wiki(), lib = { names: w.names.slice(0, 300), patches: w.patches.subarray(0, 300 * 648) }; const blob = await new Promise(r => WikiBuild._sheetCanvas(lib).toBlob(r, 'image/png')); const back = await WikiBuild._loadSheet(URL.createObjectURL(blob), 300, 128); return back && back.length === lib.patches.length && back.every((v, i) => v === lib.patches[i]); });
  ok('the Download wiki-icons.png sheet made in the browser reads back unchanged', rt === true);
  const seedN = await p3.evaluate(() => Bankwise._lib().names().length);
  ok('the shipped starter library loads: ' + seedN + ' items known before anything is taught', seedN > 600 && !(await p3.evaluate(() => Bankwise._lib().names().some(n => /^view tab/i.test(n)))));
  ok('outside Alt1 it says so and does not crash', /inside Alt1/.test(await p3.textContent('#status')) && e2.length === 0, e2.join(' | '));
  await browser.close(); srv.kill(); console.log(fails ? fails + ' FAILED' : 'all UI checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
