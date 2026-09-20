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
console.log(fails ? fails + " FAILED" : "all checks passed");
process.exit(fails ? 1 : 0);
