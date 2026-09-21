/* Guessing items from the RuneScape Wiki's inventory icons.

   The wiki's icons are the game's sprites, but trimmed to their content (so their place in
   the slot is lost) and not pixel-identical to what the client draws - close enough to GUESS
   (average colour difference 3-10 for the right item), never close enough to be certain.  So:

   - every picture, from the screen or from the wiki, is ANCHORED on its own content: bottom
     edge, and the horizontal middle of its bottom 12 rows (those rows are always below the
     stack number, so the anchor never depends on digits or on where the slot lattice is)
   - a 36x24 window above that anchor is averaged to CW x CH cells; rows that reach up into
     the stack-number band of the slot are ignored when comparing
   - a guess is only ever shown as "probably X": hovering confirms it and stores the exact look.

   Pure functions on {width,height,data} buffers; the icon library itself is plain typed arrays. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.WikiLib = factory(root.Reader);
})(this, function (Reader) {
  "use strict";
  var CW = 18, CH = 12, BYTES = CW * CH * 3, WIN_W = 36, WIN_H = 24, FOOT = 12, NCOARSE = 18;
  var GUESS_MAX = 14, SHORTLIST = 160;
  var BG = Reader.BG;

  function isContent(d, p) { return Math.abs(d[p] - BG[0]) + Math.abs(d[p + 1] - BG[1]) + Math.abs(d[p + 2] - BG[2]) > 40; }

  /* bottom edge and foot-centre of the content inside a rectangle; k = pixels per native pixel */
  function anchor(buf, x, y, w, h, k) {
    var W = buf.width, H = buf.height, d = buf.data, xx, yy, n, bottom = -1;
    var x0 = Math.max(0, x), x1 = Math.min(W, x + w), y0 = Math.max(0, y), y1 = Math.min(H, y + h);
    for (yy = y1 - 1; yy >= y0 && bottom < 0; yy--) { n = 0; for (xx = x0; xx < x1; xx++) if (isContent(d, (yy * W + xx) * 4)) n++; if (n >= 2) bottom = yy; }
    if (bottom < 0) return null;
    var left = 1e9, right = -1, top = Math.max(y0, bottom - Math.round(FOOT * k) + 1);
    for (yy = top; yy <= bottom; yy++) for (xx = x0; xx < x1; xx++) if (isContent(d, (yy * W + xx) * 4)) { if (xx < left) left = xx; if (xx > right) right = xx; }
    if (right < 0) return null;
    return { cx: (left + right + 1) / 2, bottom: bottom };
  }
  function windowPatch(buf, a, k, dx, dy) {
    return Reader.resample(buf, Math.round(a.cx - WIN_W * k / 2) + (dx || 0), a.bottom + 1 - Math.round(WIN_H * k) + (dy || 0), WIN_W * k, WIN_H * k, CW, CH);
  }
  /* what a bank slot looks like to the guesser: patches at the 9 one-pixel offsets, and the first
     cell row that lies wholly below the slot's stack-number band */
  function slotView(buf, slot, off, bandFraction) {
    off = off || { x: 0, y: 0 };
    var k = slot.w / 44, sx = slot.x - off.x, sy = slot.y - off.y, band = sy + Math.ceil(bandFraction * slot.h) + 1;
    var a = anchor(buf, sx, band, slot.w, slot.h - (band - sy), k);
    if (!a) return null;
    var top = a.bottom + 1 - Math.round(WIN_H * k), from = Math.max(0, Math.ceil((band - top) / (WIN_H * k / CH))), patches = [], dx, dy;
    if (from > CH - 4) return null;                       /* hardly anything of the item is visible below the number */
    for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) patches.push(windowPatch(buf, a, k, dx, dy));
    return { patches: patches, from: from };
  }
  /* an icon (RGBA pixels, transparent background) -> its anchored patch */
  function iconPatch(rgba, w, h) {
    var pad = 6, W = w + 2 * pad + WIN_W, Hh = h + pad + WIN_H, buf = { width: W, height: Hh, data: new Uint8ClampedArray(W * Hh * 4) }, i, x, y;
    for (i = 0; i < W * Hh; i++) { buf.data[i * 4] = BG[0]; buf.data[i * 4 + 1] = BG[1]; buf.data[i * 4 + 2] = BG[2]; buf.data[i * 4 + 3] = 255; }
    var ox = Math.floor((W - w) / 2), oy = Hh - pad - h;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var s = (y * w + x) * 4, a = rgba[s + 3] / 255, p = ((oy + y) * W + ox + x) * 4;
      buf.data[p] = rgba[s] * a + BG[0] * (1 - a); buf.data[p + 1] = rgba[s + 1] * a + BG[1] * (1 - a); buf.data[p + 2] = rgba[s + 2] * a + BG[2] * (1 - a);
    }
    var an = anchor(buf, 0, 0, W, Hh, 1);
    return an ? windowPatch(buf, an, 1, 0, 0) : null;
  }

  function coarseOf(pt, out, o) {
    /* six blocks over the bottom half of the patch - always below the number band */
    var bx, by, x, y, n = 0;
    for (by = 0; by < 2; by++) for (bx = 0; bx < 3; bx++) {
      var r = 0, g = 0, b = 0, c = 0;
      for (y = CH / 2 + by * 3; y < CH / 2 + by * 3 + 3; y++) for (x = bx * 6; x < bx * 6 + 6; x++) { var q = (y * CW + x) * 3; r += pt[q]; g += pt[q + 1]; b += pt[q + 2]; c++; }
      out[o + n++] = r / c; out[o + n++] = g / c; out[o + n++] = b / c;
    }
  }
  function meanDiff(a, ao, b, bo, from) {
    var t = 0, i, start = from * CW * 3;
    for (i = start; i < BYTES; i++) { var d = a[ao + i] - b[bo + i]; t += d < 0 ? -d : d; }
    return t / ((BYTES - start) / 3);
  }

  function IconLibrary() { this.names = []; this.files = []; this.patches = new Uint8Array(0); this.coarse = new Float32Array(0); this.n = 0; this.byName = {}; }
  IconLibrary.prototype.load = function (names, files, patches) {
    this.names = names; this.files = files; this.patches = patches; this.n = names.length;
    this.coarse = new Float32Array(this.n * NCOARSE); this.byName = {};
    for (var i = 0; i < this.n; i++) { coarseOf(patches.subarray(i * BYTES, (i + 1) * BYTES), this.coarse, i * NCOARSE); (this.byName[names[i]] || (this.byName[names[i]] = [])).push(i); }
    return this;
  };
  /* -> {name, d, alts:[other names about as close], file} or null */
  IconLibrary.prototype.guess = function (view) {
    if (!this.n || !view) return null;
    var c = new Float32Array(NCOARSE), i, j, k, self = this;
    coarseOf(view.patches[4], c, 0);
    /* shortlist = the SHORTLIST nearest by the coarse colours, kept in a small sorted list as the
       whole library streams past (sorting all of a 50,000-icon library per slot was far too slow) */
    var order = [], worst = Infinity;
    for (i = 0; i < this.n; i++) {
      var t = 0, o = i * NCOARSE;
      for (j = 0; j < NCOARSE && t < worst; j++) { var d = c[j] - this.coarse[o + j]; t += d < 0 ? -d : d; }
      if (t >= worst) continue;
      var lo = 0, hi = order.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (order[mid][0] < t) lo = mid + 1; else hi = mid; }
      order.splice(lo, 0, [t, i]);
      if (order.length > SHORTLIST) order.pop();
      if (order.length === SHORTLIST) worst = order[SHORTLIST - 1][0];
    }
    var best = {}, top = order.length;
    for (k = 0; k < top; k++) {
      i = order[k][1]; var m = 1e9;
      for (j = 0; j < view.patches.length; j++) { var v = meanDiff(view.patches[j], 0, this.patches, i * BYTES, view.from); if (v < m) m = v; }
      var nm = this.names[i]; if (!best[nm] || m < best[nm].d) best[nm] = { name: nm, d: m, file: this.files[i] };
    }
    var ranked = Object.keys(best).map(function (q) { return best[q]; }).sort(function (p, q) { return p.d - q.d; });
    if (!ranked.length || ranked[0].d > GUESS_MAX) return null;
    return { name: ranked[0].name, d: ranked[0].d, file: ranked[0].file, alts: ranked.slice(1).filter(function (q) { return q.d <= ranked[0].d + 2 && q.d <= GUESS_MAX; }).map(function (q) { return q.name; }).slice(0, 4) };
  };
  /* how unlike the wiki's picture(s) of `name` is this slot?  null when the wiki set has no such name */
  IconLibrary.prototype.distanceTo = function (name, view) {
    var idx = this.byName[name]; if (!idx || !view) return null;
    var m = 1e9, self = this;
    idx.forEach(function (i) { view.patches.forEach(function (pt) { var v = meanDiff(pt, 0, self.patches, i * BYTES, view.from); if (v < m) m = v; }); });
    return m;
  };

  /* which item does a wiki file picture?  "Party hat fragment 5.png" on the page "Party hat fragment"
     -> "Party hat fragment" (stack-size variant); "Super antifire (4).png" on "Super antifire" ->
     "Super antifire (4)" (the game's own name); anything else on the page is not this item's icon */
  function itemNameForFile(file, pageTitle) {
    var base = String(file).replace(/^File:/i, "").replace(/\.(png|gif)$/i, "").replace(/_/g, " "), t = String(pageTitle);
    if (base.toLowerCase().indexOf(t.toLowerCase()) !== 0) return null;
    var rest = base.slice(t.length);
    if (/detail|equipped|chathead|icon|concept|old|historical|beta/i.test(rest)) return null;
    var m = rest.match(/^((?: \([^)]{1,24}\))?)((?: \d{1,9})?)$/);
    return m ? t + m[1] : null;
  }

  return { CW: CW, CH: CH, BYTES: BYTES, GUESS_MAX: GUESS_MAX, anchor: anchor, slotView: slotView, iconPatch: iconPatch, meanDiff: meanDiff, IconLibrary: IconLibrary, itemNameForFile: itemNameForFile };
});
