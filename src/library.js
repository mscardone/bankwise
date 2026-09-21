/* The item library: what each item looks like, learned from the player's own screen.

   A sample is the canonical PW x PH patch from the reader plus the item's name.
   Matching is two-stage: a coarse 4x4 colour grid picks the nearest candidates, then
   the patches are compared block by block at small shifts (the slot lattice is only
   good to a pixel or two).  The score is the WORST block, not the average: look-alike
   items (potions of different colours, logs) differ in one small area only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Library = factory();
})(this, function () {
  "use strict";
  var PW = 24, PH = 16, BLK = 3, TOP = 24;
  var MATCH = 20, UNSURE = 28;     /* worst-block colour distance: below MATCH = same item */
  var MAX_SAMPLES = 8;                /* coins, arrows, runes... draw a different picture at different stack sizes */
  var FORMAT = 2;                     /* 2: the patch starts below the whole stack number (band 0.41); v1 patches are not comparable */
  var TWIN = 6;                       /* two names this close to the same slot are the same picture */

  function coarse(pt) {
    var out = new Float32Array(48), bw = PW / 4, bh = PH / 4, i, j, x, y;
    for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) {
      var r = 0, g = 0, b = 0;
      for (y = j * bh; y < (j + 1) * bh; y++) for (x = i * bw; x < (i + 1) * bw; x++) { var q = (y * PW + x) * 3; r += pt[q]; g += pt[q + 1]; b += pt[q + 2]; }
      var o = (j * 4 + i) * 3, n = bw * bh; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
    return out;
  }
  function coarseDist(a, b) { var s = 0, i; for (i = 0; i < 48; i++) { var d = a[i] - b[i]; s += d < 0 ? -d : d; } return s / 16; }

  /* worst BLK x BLK block (mean colour difference, channels summed) at one shift */
  function blockDist(a, b, dx, dy, stopAt) {
    var worst = 0, bx, by, x, y;
    for (by = 0; by + BLK <= PH; by += BLK) for (bx = 0; bx + BLK <= PW; bx += BLK) {
      var r = 0, g = 0, bl = 0, n = 0;
      for (y = by; y < by + BLK; y++) for (x = bx; x < bx + BLK; x++) {
        var x2 = x + dx, y2 = y + dy;
        if (x2 < 0 || y2 < 0 || x2 >= PW || y2 >= PH) continue;
        var p = (y * PW + x) * 3, q = (y2 * PW + x2) * 3;
        r += a[p] - b[q]; g += a[p + 1] - b[q + 1]; bl += a[p + 2] - b[q + 2]; n++;
      }
      if (n < BLK * BLK) continue;
      var v = (Math.abs(r) + Math.abs(g) + Math.abs(bl)) / n;
      if (v > worst) { worst = v; if (worst >= stopAt) return worst; }
    }
    return worst;
  }
  /* a = the slot's patch, or the list of its patches at every small offset */
  function dist(a, b) {
    if (!a.length || typeof a[0] === "number") return blockDist(a, b, 0, 0, 1e9);
    var best = 1e9, i;
    for (i = 0; i < a.length; i++) { var v = blockDist(a[i], b, 0, 0, best); if (v < best) best = v; }
    return best;
  }

  function b64(u8) { var s = "", i; for (i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")); }
  function unb64(str) {
    var s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary"), u = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  function Library() { this.samples = []; this.byName = {}; }
  Library.prototype.add = function (name, pt, source, shifts) {
    var list = this.byName[name] || (this.byName[name] = []), i, all = [pt].concat(shifts ? shifts() : []);
    /* already known this way: just note that it was seen again (twins show the most recently confirmed name) */
    for (i = 0; i < list.length; i++) if (dist(all, list[i].patch) < MATCH * 0.6) { list[i].at = Date.now(); return false; }
    if (list.length >= MAX_SAMPLES) { var old = list.shift(); this.samples.splice(this.samples.indexOf(old), 1); }
    var s = { name: name, patch: new Uint8Array(pt), coarse: coarse(pt), source: source || "taught", at: Date.now() };
    list.push(s); this.samples.push(s);
    return true;
  };
  Library.prototype.rename = function (from, to) {
    if (from === to || !this.byName[from]) return;
    var dest = this.byName[to] || (this.byName[to] = []);
    this.byName[from].forEach(function (s) { s.name = to; dest.push(s); });
    delete this.byName[from];
  };
  Library.prototype.forget = function (name) {
    var self = this;
    (this.byName[name] || []).forEach(function (s) { self.samples.splice(self.samples.indexOf(s), 1); });
    delete this.byName[name];
  };
  /* -> {name, d, state, rival, rivalD, twins}
     state: known | twin | unsure | unknown.  "twin" = several different items are drawn with exactly
     this picture (a ring and its enchanted version, a necklace at 8 and at 7 charges): looks can never
     tell them apart, so the name is the one most recently confirmed by a tooltip and the others are
     listed in `twins`. */
  Library.prototype.identify = function (pt, shifts) {
    if (!this.samples.length) return { state: "unknown", d: Infinity, rivalD: Infinity };
    var c = coarse(pt), cand = this.samples.map(function (s) { return { s: s, c: coarseDist(c, s.coarse) }; });
    cand.sort(function (p, q) { return p.c - q.c; });
    var all = null, i, pass, top = Math.min(cand.length, TOP), byName;
    /* pass 0 compares the slot as cut; only if nothing fits almost exactly is every small offset tried */
    for (pass = 0; pass < 2; pass++) {
      byName = {};
      if (pass) all = [pt].concat(shifts ? shifts() : []);
      for (i = 0; i < top; i++) {
        var d = dist(pass ? all : pt, cand[i].s.patch), e = byName[cand[i].s.name];
        if (!e || d < e.d) byName[cand[i].s.name] = { name: cand[i].s.name, d: d, at: cand[i].s.at || 0 };
      }
      var low = 1e9; for (i in byName) if (byName[i].d < low) low = byName[i].d;
      if (low < 4 || !shifts) break;
    }
    var ranked = Object.keys(byName).map(function (k) { return byName[k]; }).sort(function (p, q) { return p.d - q.d; });
    var best = ranked[0], twins = ranked.filter(function (q) { return q.d <= TWIN && q.d - best.d <= 3; });
    if (best.d <= TWIN && twins.length > 1) {
      twins.sort(function (p, q) { return q.at - p.at; });
      var rest = ranked.filter(function (q) { return twins.indexOf(q) < 0; })[0];
      return { state: "twin", name: twins[0].name, d: twins[0].d, twins: twins.map(function (q) { return q.name; }), rival: rest ? rest.name : null, rivalD: rest ? rest.d : Infinity };
    }
    var rival = ranked[1] || null, out = { name: best.name, d: best.d, rival: rival ? rival.name : null, rivalD: rival ? rival.d : Infinity };
    if (best.d <= MATCH && (!rival || rival.d > best.d * 1.35 || rival.d > MATCH)) out.state = "known";
    else if (best.d <= UNSURE) out.state = "unsure";
    else out.state = "unknown";
    return out;
  };
  /* drop the samples of `name` that look like this patch (used when the player corrects a name) */
  Library.prototype.unlearn = function (name, pt) {
    var list = this.byName[name] || [], self = this, keep = [];
    list.forEach(function (s) { if (dist(pt, s.patch) <= UNSURE) self.samples.splice(self.samples.indexOf(s), 1); else keep.push(s); });
    if (keep.length) this.byName[name] = keep; else delete this.byName[name];
  };
  Library.prototype.names = function () { return Object.keys(this.byName); };
  Library.prototype.toJSON = function () {
    return { v: FORMAT, pw: PW, ph: PH, items: this.samples.map(function (s) { return { n: s.name, p: b64(s.patch), s: s.source, t: s.at || 0 }; }) };
  };
  Library.fromJSON = function (o) {
    var lib = new Library();
    if (o && o.v === FORMAT && o.pw === PW && o.ph === PH) (o.items || []).forEach(function (it) {
      try { var pt = unb64(it.p); if (pt.length === PW * PH * 3) { var s = { name: it.n, patch: pt, coarse: coarse(pt), source: it.s || "taught", at: it.t || 0 }; (lib.byName[it.n] || (lib.byName[it.n] = [])).push(s); lib.samples.push(s); } } catch (e) { /* skip a damaged entry */ }
    });
    return lib;
  };
  Library.dist = dist; Library.coarse = coarse; Library.coarseDist = coarseDist;
  Library.MATCH = MATCH; Library.UNSURE = UNSURE; Library.FORMAT = FORMAT;
  return Library;
});
