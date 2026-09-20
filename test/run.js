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
  ok("a name in the same white as the action reads as the whole line: " + JSON.stringify(white && white.text), white && white.text === "Withdraw-All Fremennik blade");
  ok("no tooltip -> nothing read", Tip.read(plainBuf, 705, 342) === null);
  var w0 = tip.area.whole, hover = Reader.readBuffer(hoverBuf, false, 0, 0, plain.grid, { y0: w0.y, y1: w0.y + w0.height });
  ok("tooltip over the bank: " + rawHover.grid.rows.length + " rows found on their own, " + hover.grid.rows.length + " with the previous read to lean on", rawHover.grid.rows.length < 20 && hover.grid.rows.length === 20 && hover.slots.every(function (s) { return plain.slots.some(function (q) { return q.x === s.x && q.y === s.y; }); }));
  /* teach from the plain capture, recognise in the hover capture wherever the tooltip is not in the way */
  var lib = new Library(); plain.slots.forEach(function (s) { lib.add("p" + s.x + "," + s.y, s.patch, "test", s.shifts); });
  var w = tip.area.whole, right = 0, wrong = [], twins = [], covered = 0;
  hover.slots.forEach(function (s) {
    if (s.x < w.x + w.width + 4 && s.x + s.w > w.x - 4 && s.y < w.y + w.height + 4 && s.y + s.h > w.y - 4) { covered++; return; }
    var id = lib.identify(s.patch, s.shifts); if (id.state === "known" && id.name === "p" + s.x + "," + s.y) right++; else if (id.state === "known") wrong.push(s.x + "," + s.y + " -> " + id.name); else twins.push(s.x + "," + s.y + " d=" + id.d.toFixed(1) + " rival d=" + id.rivalD.toFixed(1));
  });
  ok("same items recognised between the two captures: " + right + " of " + (hover.slots.length - covered) + " pixel-exact (" + covered + " behind the tooltip), none wrong", !wrong.length && right >= 175, wrong.join("  "));
  ok("three different items in this bank share one identical icon -> reported as unsure, never guessed: " + twins.join(" | "), twins.length === 3 && twins.every(function (t) { return /d=0.0 rival d=0.0/.test(t); }), twins.join(" | "));
})();
console.log(fails ? fails + " FAILED" : "all checks passed");
process.exit(fails ? 1 : 0);
