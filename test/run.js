/* Headless checks of the reader and the item library.   npm test
   snip125-*.png  = Scott's Windows snips at 125% display scaling (bank window only)
   synth-native-* = the same snips shrunk to native size and pasted into a fake 2560x1351
                    Alt1-style capture (noisy game world, a second panel in the bank's
                    background colour, black band right/bottom).  Replace with real Alt1
                    captures as soon as there are some. */
var path = require("path"), loadPng = require("../tools/pngload.js");
var Reader = require("../src/reader.js")(null), Library = require("../src/library.js");
var fails = 0;
function ok(name, cond, extra) { console.log((cond ? "  ok   " : "  FAIL ") + name + (cond ? "" : "  -> " + extra)); if (!cond) fails++; }
function load(f) { return Reader.readBuffer(loadPng(path.join(__dirname, f))); }
function lastSection(r) { var s = Math.max.apply(null, r.slots.map(function (q) { return q.section; })); var rows = r.slots.filter(function (q) { return q.section === s; }); var r0 = Math.min.apply(null, rows.map(function (q) { return q.row; })); return rows.map(function (q) { return { s: q, key: "r" + (q.row - r0) + "c" + q.col }; }); }

[["snip125", 55, 0], ["synth-native", 44, 1]].forEach(function (set) {
  console.log(set[0]);
  var tab = load(set[0] + "-tab.png"), main = load(set[0] + "-main.png");
  ok("tab view: grid found", !!tab.grid, JSON.stringify(tab));
  ok("main view: grid found", !!main.grid, JSON.stringify(main));
  if (!tab.grid || !main.grid) return;
  ok("pitch " + tab.grid.pitch.toFixed(2) + " / " + main.grid.pitch.toFixed(2) + " ~ " + set[1], Math.abs(tab.grid.pitch - set[1]) < 0.6 && Math.abs(main.grid.pitch - set[1]) < 0.6);
  ok("10 columns in both", tab.grid.cols.length === 10 && main.grid.cols.length === 10, tab.grid.cols.length + "/" + main.grid.cols.length);
  ok("tab view: 104 items in 11 rows", tab.slots.length === 104 && tab.grid.rows.length === 11, tab.slots.length + " in " + tab.grid.rows.length);
  var secs = {}; main.grid.rows.forEach(function (r) { secs[r.section] = (secs[r.section] || 0) + 1; });
  ok("main view: 4 sections of 5,4,6,5 rows", JSON.stringify(secs) === JSON.stringify({ 0: 5, 1: 4, 2: 6, 3: 5 }), JSON.stringify(secs));
  ok("main view: the cut-off bottom row is skipped or complete", main.slots.every(function (s) { return s.y + s.h <= main.grid.y + main.grid.h + 1; }));
  /* teach from the tab view, recognise in the main view (same items, 900px lower on screen) */
  var lib = new Library();
  tab.slots.forEach(function (s) { lib.add("r" + s.row + "c" + s.col, s.patch, "test", s.shifts); });
  var right = 0, unsure = 0, wrong = [];
  lastSection(main).forEach(function (q) { var id = lib.identify(q.s.patch, q.s.shifts); if (id.state === "known" && id.name === q.key) right++; else if (id.state === "known") wrong.push(q.key + "->" + id.name); else unsure++; });
  ok("recognises the tab-4 items in the main view: " + right + " right, " + unsure + " unsure", right >= 45 && !wrong.length, "wrong: " + wrong.join(" "));
  /* every slot of the tab view is told apart from every other */
  var self = 0, confused = [];
  tab.slots.forEach(function (s) { var id = lib.identify(s.patch, s.shifts), k = "r" + s.row + "c" + s.col; if (id.name === k) self++; else confused.push(k + "->" + id.name); });
  ok("tells all " + tab.slots.length + " items apart (" + self + ")", self >= tab.slots.length - 1, confused.join(" "));
  var back = Library.fromJSON(JSON.parse(JSON.stringify(lib.toJSON())));
  ok("library survives save/load (" + back.samples.length + " samples, " + Math.round(JSON.stringify(lib.toJSON()).length / 1024) + " KB)", back.samples.length === lib.samples.length && back.identify(tab.slots[7].patch, tab.slots[7].shifts).name === "r0c7");
  /* things that are not a bank */
  if (set[2]) {
    var buf = loadPng(path.join(__dirname, set[0] + "-tab.png")), i;
    for (i = 0; i < buf.data.length; i += 4) if ((i / 4) % buf.width > 600 && (i / 4) % buf.width < 1100) { buf.data[i] = 80; buf.data[i + 1] = 120; buf.data[i + 2] = 60; }
    var none = Reader.readBuffer(buf);
    ok("no bank on screen -> no grid (" + (none.error || "found " + none.slots.length + " slots") + ")", !!none.error || none.slots.length === 0);
  }
});
/* real Alt1 captures from Scott's PC (2560x1351 buffer, game at native size) */
console.log("real captures");
(function () {
  var Module = require("module"), orig = Module._resolveFilename;
  Module._resolveFilename = function (r) { if (r === "alt1/base") return path.join(__dirname, "../vendor/a1lib.js"); return orig.apply(this, arguments); };
  global.window = global;
  var OCR = require("../vendor/ocr.js"), fonts = {};
  ["12pt", "14pt", "16pt", "18pt"].forEach(function (s) { fonts[s] = require("../vendor/font-chat-" + s + ".js"); });
  var Tip = require("../src/tooltip.js")(OCR, fonts);
  var plainBuf = loadPng(path.join(__dirname, "capture-plain.png")), hoverBuf = loadPng(path.join(__dirname, "capture-hover.png"));
  var plain = Reader.readBuffer(plainBuf), rawHover = Reader.readBuffer(hoverBuf);
  ok("bank found: pitch " + (plain.grid && plain.grid.pitch) + ", " + (plain.grid && plain.grid.cols.length) + " columns, " + (plain.slots && plain.slots.length) + " items", plain.grid && plain.grid.pitch === 44 && plain.grid.cols.length === 10 && plain.slots.length === 193, JSON.stringify(plain.error));
  var tip = Tip.read(hoverBuf, 705, 342);
  ok("tooltip found and read: " + JSON.stringify(tip && tip.text) + " with " + (tip && tip.font), tip && tip.text === "Fremennik blade", JSON.stringify(tip));
  /* the game colours the name by item type: recolour the real tooltip's name and read it again */
  function recolour(f) {
    var o = { width: hoverBuf.width, height: hoverBuf.height, data: new Uint8ClampedArray(hoverBuf.data) }, x0 = 9999, x, y, q;
    for (y = 368; y < 392; y++) for (x = 602; x < 806; x++) { q = (y * o.width + x) * 4; if (o.data[q] > 200 && o.data[q + 2] < 130 && x < x0) x0 = x; }
    for (y = 368; y < 392; y++) for (x = x0 - 2; x < 806; x++) { q = (y * o.width + x) * 4; var c = f(o.data[q], o.data[q + 1], o.data[q + 2]); o.data[q] = c[0]; o.data[q + 1] = c[1]; o.data[q + 2] = c[2]; }
    return o;
  }
  var recol = [["cyan", function (r, g, b) { return [b, g, r]; }], ["green", function (r, g, b) { return [b, r, b]; }], ["red", function (r, g, b) { return [r, b, b]; }]].map(function (t) { var r = Tip.read(recolour(t[1]), 705, 342); return t[0] + "=" + (r && r.text); });
  ok("name colour is measured, not assumed: " + recol.join(", "), recol.every(function (t) { return /=Fremennik blade$/.test(t); }));
  var white = Tip.read(recolour(function (r) { return [Math.round(r * 227 / 248), Math.round(r * 215 / 248), Math.round(r * 207 / 248)]; }), 705, 342);
  ok("a name in the very same white as the action still comes out alone: " + JSON.stringify(white && white.text), white && white.text === "Fremennik blade");
  var whiteBuf = loadPng(path.join(__dirname, "capture-hover-white.png")), wt = Tip.read(whiteBuf, 694, 540);
  ok("free-to-play item (name in pale cyan, close to the action's white): " + JSON.stringify(wt && wt.text) + " from line " + JSON.stringify(wt && wt.line), wt && wt.text === "Nature rune" && wt.colour.join() === "184,209,209", JSON.stringify(wt));
  ok("the action word alone is never a name", Tip.stripAction("Withdraw-All") === "" && Tip.stripAction("Withdraw-All Coins") === "Coins" && Tip.stripAction("Clean guam") === "Clean guam");
  /* both real tooltips (small two-panel one, big one with stats), borders included, pasted under
     every second slot of the bank: same rows, same slots, hovered slot never hidden */
  (function () {
    var tipsrc = [{ buf: whiteBuf, x: 603, y: 563, w: 184, h: 55, mx: 694, my: 540 }, { buf: hoverBuf, x: 598, y: 364, w: 212, h: 142, mx: 705, my: 342 }];
    function paste(t, mx, my) { var o = { width: plainBuf.width, height: plainBuf.height, data: new Uint8ClampedArray(plainBuf.data) }, x, y, tx = mx + t.x - t.mx, ty = my + t.y - t.my; for (y = 0; y < t.h; y++) for (x = 0; x < t.w; x++) { if (ty + y >= o.height || tx + x < 0) continue; var sp = ((t.y + y) * t.buf.width + t.x + x) * 4, dp = ((ty + y) * o.width + tx + x) * 4; o.data[dp] = t.buf.data[sp]; o.data[dp + 1] = t.buf.data[sp + 1]; o.data[dp + 2] = t.buf.data[sp + 2]; } return o; }
    var bad = [], n = 0, rowsWant = plain.grid.rows.map(function (q) { return q.y; }).join();
    tipsrc.forEach(function (t, ti) {
      for (var r = 0; r < plain.grid.rows.length; r++) for (var c = ti; c < 10; c += 2) {
        var mx = Math.round(plain.grid.cols[c]), my = Math.round(plain.grid.rows[r].y), res = Reader.readBuffer(paste(t, mx, my), false, 0, 0, plain.grid, null); n++;
        var want = plain.slots.some(function (q) { return mx >= q.x && mx < q.x + q.w && my >= q.y && my < q.y + q.h; });
        var got = res.slots && res.slots.filter(function (q) { return mx >= q.x && mx < q.x + q.w && my >= q.y && my < q.y + q.h; })[0];
        var rowsGot = res.grid && res.grid.rows.map(function (q) { return q.y; }).join();
        var open = res.slots ? res.slots.filter(function (q) { return !q.covered; }) : [], hidden = res.slots ? res.slots.length - open.length : 0;
        var stray = open.filter(function (q) { return !plain.slots.some(function (z) { return z.x === q.x && z.y === q.y; }); }).length;
        if (res.error || rowsGot !== rowsWant || stray || open.length + hidden < plain.slots.length || (want && (!got || got.covered))) bad.push("tip" + ti + " " + r + "," + c + ":" + (res.error || (rowsGot !== rowsWant ? "rows moved " + rowsGot.slice(-40) : stray + " stray, " + open.length + "+" + hidden)));
      }
    });
    ok("real tooltips placed under " + n + " slots: rows never move, every item still there, hovered slot never hidden", !bad.length, bad.length + " bad: " + bad.slice(0, 12).join(" "));
  })();
  /* a big foreign box over the bank (stands in for a right-click menu): lean on the previous lattice */
  (function () {
    var o = { width: plainBuf.width, height: plainBuf.height, data: new Uint8ClampedArray(plainBuf.data) }, x, y;
    for (y = 300; y < 640; y++) for (x = 690; x < 1000; x++) { var q = (y * o.width + x) * 4; o.data[q] = 70 + (x % 7) * 9; o.data[q + 1] = 60 + (y % 5) * 11; o.data[q + 2] = 50; }
    var alone = Reader.readBuffer(o), leaning = Reader.readBuffer(o, false, 0, 0, plain.grid, null);
    var moved = leaning.grid ? leaning.grid.rows.filter(function (q) { return !plain.grid.rows.some(function (z) { return Math.abs(z.y - q.y) < 0.01; }); }).length : -1;
    ok("a menu-sized box over the bank: " + (alone.error ? "unreadable alone" : alone.grid.rows.length + " rows alone") + ", " + (leaning.error || leaning.grid.rows.length + " rows, " + moved + " out of place") + " with the previous read", !leaning.error && moved === 0 && leaning.grid.rows.length >= 12);
    for (x = 0; x < o.data.length; x += 4) { o.data[x] = 90; o.data[x + 1] = 130; o.data[x + 2] = 70; }
    ok("bank closed: the previous lattice is NOT reused", !!Reader.readBuffer(o, false, 0, 0, plain.grid, null).error);
  })();
  /* a small tab: only one, two or three rows of items under the tab buttons */
  (function () {
    var res = [1, 2, 3].map(function (keep) {
      var o = { width: plainBuf.width, height: plainBuf.height, data: new Uint8ClampedArray(plainBuf.data) }, x, y, cut = Math.round(plain.grid.rows[keep - 1].y + 22);
      for (y = cut; y < 1036; y++) for (x = 677; x < 1131; x++) { var q = (y * o.width + x) * 4; o.data[q] = 51; o.data[q + 1] = 46; o.data[q + 2] = 41; }
      var r = Reader.readBuffer(o);
      return !r.error && r.grid.rows.length === keep && r.grid.cols.length === 10 && Math.abs(r.grid.cols[0] - plain.grid.cols[0]) < 1.5 && Math.abs(r.grid.rows[0].y - plain.grid.rows[0].y) < 1.5 ? "ok" : (r.error || JSON.stringify(r.grid.rows.map(function (z) { return z.y; })) + " cols0 " + r.grid.cols[0]);
    });
    ok("a tab with only 1, 2 or 3 rows: lattice still on the items (the tab buttons do not count as a row)", res.join() === "ok,ok,ok", res.join(" | "));
  })();
  /* other interfaces share the bank's background colour: a lattice of things without the bank's tab
     buttons above it is not a bank (Scott: the Slayer rewards screen got boxes drawn on it) */
  (function () {
    var o = { width: 1400, height: 900, data: new Uint8ClampedArray(1400 * 900 * 4) }, x, y, r, c, q;
    for (q = 0; q < o.data.length; q += 4) { o.data[q] = 90 + (q % 13) * 5; o.data[q + 1] = 120; o.data[q + 2] = 70; o.data[q + 3] = 255; }
    for (y = 200; y < 640; y++) for (x = 300; x < 800; x++) { q = (y * 1400 + x) * 4; o.data[q] = 51; o.data[q + 1] = 46; o.data[q + 2] = 41; }
    for (r = 0; r < 5; r++) for (c = 0; c < 9; c++) for (y = 0; y < 30; y++) for (x = 0; x < 30; x++) if ((x + y) % 3) { q = ((260 + r * 44 + y) * 1400 + 330 + c * 44 + x) * 4; o.data[q] = 150 + c * 8; o.data[q + 1] = 90 + r * 20; o.data[q + 2] = 60; }
    var res = Reader.readBuffer(o);
    ok("a shop-like panel (same background, 9x5 lattice of things, no tab buttons) is not a bank: " + (res.error || res.slots.length + " slots"), !!res.error);
    var shot = Reader.readBuffer(loadPng(path.join(__dirname, "shot-slayer-rewards.png")));
    ok("Scott's Slayer rewards screenshot is not a bank: " + (shot.error || shot.slots.length + " slots"), !!shot.error);
  })();
  /* stack sizes */
  (function () {
    var Stack = require("../src/stack.js"), got = {}, unread = 0;
    plain.slots.forEach(function (sl) { var q = Stack.read(plainBuf, sl); if (!q) unread++; else got[sl.row + "," + sl.col] = q; });
    var row0 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (c) { return got["0," + c] ? got["0," + c].text || "-" : "?"; }).join(" ");
    ok("stack numbers of the first row: " + row0, row0 === "91M 74 12 2 4 2 2 - 6085 110" && got["0,0"].qty === 91000000 && got["0,0"].approx && got["0,7"].qty === 1);
    var all = Object.keys(got).map(function (k) { return got[k].text; });
    ok("every slot's number reads (" + unread + " unread); 5000, 4906, 7442, 2525 and 3561 are among them", unread === 0 && ["5000", "4906", "7442", "2525", "3561"].every(function (t) { return all.indexOf(t) >= 0; }));
    var hov = Reader.readBuffer(hoverBuf, false, 0, 0, plain.grid, null), same = 0, diff = [];
    hov.slots.forEach(function (sl) { if (sl.covered) return; var a = Stack.read(hoverBuf, sl), b = got[sl.row + "," + sl.col]; if (a && b && a.text === b.text) same++; else diff.push(sl.row + "," + sl.col); });
    ok("same numbers in the second capture (" + same + " slots)", diff.length === 0, diff.join(" "));
  })();
  ok("no tooltip -> nothing read", Tip.read(plainBuf, 705, 342) === null);
  var w0 = tip.area.whole, hover = Reader.readBuffer(hoverBuf, false, 0, 0, plain.grid, { y0: w0.y, y1: w0.y + w0.height });
  ok("tooltip over the bank: " + rawHover.grid.rows.length + " rows found on their own, " + hover.grid.rows.length + " with the previous read to lean on", hover.grid.rows.length === 20 && hover.slots.every(function (s) { return plain.slots.some(function (q) { return q.x === s.x && q.y === s.y; }); }));
  /* teach from the plain capture, recognise in the hover capture wherever the tooltip is not in the way */
  var lib = new Library(); plain.slots.forEach(function (s) { lib.add("p" + s.x + "," + s.y, s.patch, "test", s.shifts); });
  var w = tip.area.whole, right = 0, wrong = [], twins = [], covered = 0;
  hover.slots.forEach(function (s) {
    if (s.x < w.x + w.width + 4 && s.x + s.w > w.x - 4 && s.y < w.y + w.height + 4 && s.y + s.h > w.y - 4) { covered++; return; }
    var id = lib.identify(s.patch, s.shifts), me = "p" + s.x + "," + s.y;
    if (id.state === "known" && id.name === me) right++; else if (id.state === "twin" && id.twins.indexOf(me) >= 0) twins.push(me + " = " + id.twins.length + " alike"); else wrong.push(me + " -> " + id.state + " " + id.name);
  });
  ok("same items recognised between the two captures: " + right + " told apart + " + twins.length + " in look-alike groups of " + (hover.slots.length - covered) + " (" + covered + " behind the tooltip), none wrong", !wrong.length && right >= 150, wrong.join("  "));
  ok("items drawn with one identical picture (enchanted jewellery, charges...) are grouped, not guessed: " + twins.length + " slots", twins.length >= 3 && twins.length <= 20, twins.join(" | "));
  /* a twin shows whichever name a tooltip confirmed last */
  var tw = hover.slots.filter(function (q) { return lib.identify(q.patch, q.shifts).state === "twin"; })[0], names = lib.identify(tw.patch, tw.shifts).twins;
  lib.add(names[names.length - 1], tw.patch, "test", tw.shifts);
  ok("a look-alike shows the name confirmed most recently", lib.identify(tw.patch, tw.shifts).name === names[names.length - 1]);
  lib.rename(names[0], "Renamed item"); ok("rename keeps the samples", !lib.byName[names[0]] && lib.byName["Renamed item"].length >= 1);
})();
(function () {
  var V = require("../src/verdict.js"), D = require("../src/data.js");
  ok("K/M/B shorthand never rounds up: " + [950, 12345, 999999, 1234567, 2147483647].map(V.short).join(" "), [950, 12345, 999999, 1234567, 2147483647].map(V.short).join(" ") === "950 12.3K 999K 1.23M 2.14B");
  var cuts = [1e3, 1e4, 1e5, 1e6, 1e7];
  ok("value tiers follow the player's cutoffs", V.tier(999, cuts).id === "t0" && V.tier(1000, cuts).id === "t1" && V.tier(5e7, cuts).id === "t5" && V.tier(500, [400, 1e4, 1e5, 1e6, 1e7]).id === "t1" && V.tier(null, cuts).id === "tx");
  var prices = { "%LAST_UPDATE%": 1 }, i; for (i = 0; i < 150; i++) prices["Item " + i] = 100 + i;
  var pages = { 1: { title: "Module:GEPrices/data.json", revisions: [{ slots: { main: { "*": JSON.stringify(prices) } } }] }, 2: { title: "Module:GEHighAlchs/data.json", revisions: [{ slots: { main: { "*": JSON.stringify({ "Item 1": 77 }) } } }] }, 3: { title: "Module:GEValues/data.json", revisions: [{ slots: { main: { "*": JSON.stringify({ "Item 2": 100 }) } } }] } };
  var p = D._parseBulk({ query: { pages: pages } });
  ok("wiki price tables: price, high alch, and alch worked out from value when the alch table has no entry", p && p["item 1"][0] === 101 && p["item 1"][1] === 77 && p["item 2"][1] === 60 && !p["%last_update%"], JSON.stringify(p && p["item 1"]));
  ok("a missing price table is reported, not half-used", D._parseBulk({ query: { pages: { 2: pages[2] } } }) === null);
})();
(function () {
  var K = require("../src/kinds.js"), last = K.TEMPLATES[K.TEMPLATES.length - 1];
  function tab(n, cats) { return K.tabFor(K.kindOf(n, cats || []), "geech", n).number; }
  ok("Geech Layout ships last, with 8 tabs", last.id === "geech" && last.name === "Geech Layout" && last.tabs.length === 8);
  var want = { "Abyssal whip": 2, "Bandos tassets": 2, "Shark": 2, "Deathdealer robe top": 2, "Dragon bones": 2, "Air rune": 3, "Polypore staff": 3, "Garb of subjugation": 3, "Varrock teleport": 3, "Prayer potion (4)": 3, "Ring of slaying (8)": 3,
    "Coal": 4, "Magic logs": 4, "Ranarr seed": 4, "Golden mining top": 4, "Watering can (8)": 4, "Steel bar": 5, "Oak plank": 5, "Red dragonhide": 5, "Raw shark": 5, "Blacksmith's boots": 5, "Clue scroll (hard)": 6, "Crystal key": 6, "Slayer Wildcard": 6, "Portable range": 6, "Party hat fragment": 8, "Spade": 4, "Some unknown thing": 1 };
  var wrong = Object.keys(want).filter(function (n) { return tab(n) !== want[n]; }).map(function (n) { return n + " -> " + tab(n) + ", wanted " + want[n]; });
  ok("Geech Layout puts " + Object.keys(want).length + " sample items in the right tabs", !wrong.length, wrong.join("; "));
  ok("a wiki quest item goes to Quest Items even when its name says weapon; a quest potion stays a potion", tab("Silverlight", ["Quest items"]) === 7 && tab("Super restore (4)", ["Quest items"]) === 3);
  ok("Geech Layout: jewellery sits with Magic, bones and ashes with Combat", tab("Ruby ring") === 3 && tab("Amulet of power") === 3 && tab("Dragon bones") === 2 && tab("Infernal ashes") === 2);
  ok("Geech Layout: valuable gear goes where gear goes; seasonal, discontinued and cosmetic items and unreclaimable quest rewards go to the last tab", tab("Noxious scythe") === 2 && tab("Santa hat") === 8 && tab("Some cape override", ["Cosmetic overrides"]) === 8 && tab("Old thing", ["Discontinued content"]) === 8 && tab("Excalibur", ["Quest rewards"]) === 8 && tab("Reward hat", ["Quest rewards", "Reclaimable from Diango"]) !== 8 || false);
  var V2 = require("../src/verdict.js"), prof = { levels: [72, 72] };
  function judge(it) { return V2.judge(Object.assign({ cats: [], tradeable: true, price: 5000, alch: 100 }, it), { useSkills: true, junkBelow: 500 }, prof, K); }
  ok("gear below your tier is marked sell, at your tier kept, upgradeable always kept, and nothing changes with skills off", judge({ name: "Rune platebody", kind: "armour", gear: { tier: 50, cls: "melee" } }).id === "sell" && judge({ name: "Bandos chestplate", kind: "armour", gear: { tier: 70, cls: "melee" } }).id === "keep" && judge({ name: "Deathwarden hood", kind: "armour", upgradeable: true, gear: { tier: 10 } }).id === "keep" && K.upgradeable("Deathdealer robe top") && !K.upgradeable("Rune platebody") && V2.judge({ name: "Rune platebody", kind: "armour", cats: [], tradeable: true, price: 5000, gear: { tier: 50 } }, { junkBelow: 500 }, prof, K).id === "keep");
  var fin = { quests: { "ghosts ahoy": { title: "Ghosts Ahoy", status: "COMPLETED" } }, levels: [] };
  ok("Ectophial: a teleport that a finished quest also used stays a teleport and is kept", K.kindOf("Ectophial", ["Quest items", "Ghosts Ahoy"]) === "teleport" && V2.judge({ name: "Ectophial", kind: "teleport", questItem: true, cats: ["Quest items", "Ghosts Ahoy"], tradeable: false, price: null, known: true }, { useQuests: true }, fin, K).id !== "destroy" && V2.judge({ name: "Ectophial", kind: "teleport", questItem: true, cats: ["Quest items", "Ghosts Ahoy"], tradeable: false, price: null, known: true }, { useQuests: true }, fin, K).id !== "alch");
  var qi = { name: "Bedsheet", kind: "quest", questItem: true, cats: ["Quest items", "Ghosts Ahoy"], tradeable: false, price: null };
  ok("nothing alchable is destroyed: finished quest item -> high alch when the wiki gives it a value, destroy when it cannot be alched", V2.judge(Object.assign({ gear: { value: 100, alchable: true } }, qi), { useQuests: true }, fin, K).id === "alch" && V2.judge(Object.assign({ gear: { value: 100, alchable: false } }, qi), { useQuests: true }, fin, K).id === "destroy" && /needs 55 Magic/.test(V2.judge(Object.assign({ gear: { value: 100, alchable: true } }, qi), { useQuests: true }, { quests: fin.quests, levels: [1, 1, 1, 1, 1, 1, 40] }, K).reason));
  ok("Diango items are marked Diango, not destroy; cheap junk is high alched", V2.judge({ name: "Santa hat", kind: "holiday", diango: true, cats: [], tradeable: false, price: null }, {}, null, K).id === "diango" && V2.judge({ name: "Rusty sword", kind: "weapon", cats: [], tradeable: true, price: 60, alch: 15 }, { junkBelow: 500 }, null, K).id === "alch" && V2.judge({ name: "Odd sword", kind: "weapon", cats: [], tradeable: true, price: 60, alch: 0 }, { junkBelow: 500 }, null, K).id === "sell");
  ok("teleport destinations: " + K.teleportsTo("Games necklace (8)").slice(0, 30) + "...", /Barbarian Outpost/.test(K.teleportsTo("Games necklace (8)")) && K.teleportsTo("Varrock teleport") === "Varrock" && /Ectofuntus/.test(K.teleportsTo("Ectophial")) && K.teleportsTo("Rune platebody") === "");
  var log = { quests: { "nature spirit": { title: "Nature Spirit", status: "COMPLETED" }, "in aid of the myreque": { title: "In Aid of the Myreque", status: "NOT_STARTED" } }, levels: [] }, sick = { name: "Silver sickle (b)", kind: "quest", cats: ["Quest items"], tradeable: false, price: null, known: true };
  ok("quest log: kept while any linked quest is unfinished; all finished -> the player's call when only links say so, get rid of it when the wiki's category does",
    /Still needed for In Aid of the Myreque/.test(V2.judge(Object.assign({ quests: ["Nature Spirit", "In Aid of the Myreque"] }, sick), { useQuests: true }, log, K).reason) &&
    V2.judge(Object.assign({ quests: ["Nature Spirit"], questSure: false }, sick), { useQuests: true }, log, K).id === "review" &&
    V2.judge(Object.assign({ quests: ["Nature Spirit"], questSure: true }, sick), { useQuests: true }, log, K).id === "destroy");
  ok("an untradeable teleport item is kept, not sent for review", V2.judge({ name: "Skull of Remembrance", kind: "teleport", cats: [], tradeable: false, price: null, known: true }, {}, null, K).id === "keep");
  ok("a quest reward that cannot be reclaimed is kept", V2.judge({ name: "Excalibur", kind: "keepsake", cats: ["Quest rewards"], tradeable: false, price: null }, {}, null, K).id === "keep");
  ok("Geech Layout: charging items go with the tokens", tab("Artisanal gears") === 6 && tab("Silverhawk feathers") === 6 && tab("Silverhawk down") === 6 && tab("Divine charge") === 6 && tab("Piece of Het") === 6 && tab("Feather") === 5 && tab("Fletching cleaner") === 5 && tab("Spring cleaner 3000") === 5);
  ok("an Archaeology artefact shaped like a weapon is still Archaeology (Gathering in the Geech Layout)", K.kindOf("Venator light crossbow", ["Artefacts", "Zarosian artefacts"]) === "archaeology" && tab("Venator light crossbow", ["Artefacts"]) === 4 && K.kindOf("Venator light crossbow", []) === "weapon");
  ok("the other layouts are unchanged by the Geech name rules", K.tabFor("metal", "five", "Steel bar").number === 4 && K.tabFor("weapon", "pvm", "Polypore staff").number === 2);
})();
console.log(fails ? fails + " FAILED" : "all checks passed");
process.exit(fails ? 1 : 0);
