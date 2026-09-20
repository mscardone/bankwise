/* Screen reading for the bank, at any interface scale and any bank-window size.

   1. find the bank's item area: the biggest patch of the flat bank background colour,
      split at solid vertical walls (panel borders, the scrollbar)
   2. fit the slot lattice: item columns are periodic, so the pitch and the column
      positions come from the column profile; rows are found per section (the main
      bank view has "Tab N" dividers, so rows are not one global lattice)
   3. cut a canonical patch out of every slot (below the stack number, area-averaged
      to PW x PH so it is the same at every interface scale) for the item library

   Pure functions take a plain {width,height,data} RGBA buffer so node can test them;
   read() is the only part that talks to Alt1. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.Reader = factory(root.A1lib);
})(this, function (A1lib) {
  "use strict";

  var BG = [51, 46, 41], BG_TOL = 18;      /* flat colour behind the bank's items */
  var CELL = 32;                           /* coarse cell for finding the bank */
  var PW = 24, PH = 16;                    /* canonical patch size */
  var NUM_BAND = 0.32;                     /* top of the slot, where the stack number is drawn */
  var SIDE = 0.09;                         /* slot margin left and right */

  function isBg(d, p) {
    var a = d[p] - BG[0], b = d[p + 1] - BG[1], c = d[p + 2] - BG[2];
    return (a < 0 ? -a : a) + (b < 0 ? -b : b) + (c < 0 ? -c : c) <= BG_TOL;
  }

  /* ---------- 1. candidate areas: connected coarse cells that are mostly background ---------- */
  function findAreas(buf) {
    var W = buf.width, H = buf.height, d = buf.data, cw = Math.floor(W / CELL), ch = Math.floor(H / CELL);
    var on = new Uint8Array(cw * ch), cx, cy, x, y, n, t;
    for (cy = 0; cy < ch; cy++) for (cx = 0; cx < cw; cx++) {
      n = 0; t = 0;
      for (y = cy * CELL; y < cy * CELL + CELL; y += 2) for (x = cx * CELL; x < cx * CELL + CELL; x += 2) { t++; if (isBg(d, (y * W + x) * 4)) n++; }
      if (n >= 0.3 * t) on[cy * cw + cx] = 1;
    }
    var seen = new Uint8Array(cw * ch), areas = [], stack, i, j, k;
    for (i = 0; i < on.length; i++) {
      if (!on[i] || seen[i]) continue;
      var x0 = cw, y0 = ch, x1 = -1, y1 = -1, cnt = 0;
      stack = [i]; seen[i] = 1;
      while (stack.length) {
        j = stack.pop(); cx = j % cw; cy = (j - cx) / cw; cnt++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        var nb = [cx > 0 ? j - 1 : -1, cx < cw - 1 ? j + 1 : -1, cy > 0 ? j - cw : -1, cy < ch - 1 ? j + cw : -1];
        for (k = 0; k < 4; k++) if (nb[k] >= 0 && on[nb[k]] && !seen[nb[k]]) { seen[nb[k]] = 1; stack.push(nb[k]); }
      }
      if (x1 - x0 >= 4 && y1 - y0 >= 1) {
        /* one cell of margin at the sides, two above and below: a dense last row of items plus the
           button bar under it can fall below the background threshold */
        var ax = Math.max(0, (x0 - 1) * CELL), ay = Math.max(0, (y0 - 2) * CELL);
        areas.push({ x: ax, y: ay, w: Math.min(W, (x1 + 2) * CELL) - ax, h: Math.min(H, (y1 + 3) * CELL) - ay, cells: cnt });
      }
    }
    areas.sort(function (a, b) { return b.cells - a.cells; });
    return areas;
  }

  function runs(v, thr) {
    var out = [], s = -1, i;
    for (i = 0; i <= v.length; i++) {
      var hit = i < v.length && v[i] > thr;
      if (hit && s < 0) s = i;
      if (!hit && s >= 0) { out.push({ a: s, b: i - 1, c: (s + i - 1) / 2, n: i - s }); s = -1; }
    }
    return out;
  }
  function median(a) { var s = a.slice().sort(function (p, q) { return p - q; }); return s.length ? s[s.length >> 1] : 0; }

  /* ---------- 2. the slot lattice inside one area ---------- */
  function fitGrid(buf, area) {
    var W = buf.width, d = buf.data, ax = area.x, ay = area.y, aw = area.w, ah = area.h, x, y, i, k;
    /* non-background mask of the area */
    var m = new Uint8Array(aw * ah);
    for (y = 0; y < ah; y++) for (x = 0; x < aw; x++) if (!isBg(d, ((ay + y) * W + ax + x) * 4)) m[y * aw + x] = 1;
    /* vertical walls: columns with (almost) no background at all, judged over the rows that
       have background somewhere - split there and keep the widest part */
    var colFill = new Float64Array(aw);
    for (x = 0; x < aw; x++) { k = 0; for (y = 0; y < ah; y++) k += m[y * aw + x]; colFill[x] = k / ah; }
    var open = [];
    for (x = 0; x < aw; x++) open.push(colFill[x] < 0.9 ? 1 : 0);
    var segs = runs(open, 0).filter(function (s) { return s.n >= 100; });
    if (!segs.length) return null;
    segs.sort(function (p, q) { return q.n - p.n; });
    var best = null;
    for (i = 0; i < segs.length && i < 3 && !best; i++) best = fitSegment(buf, m, area, segs[i]);
    return best;
  }

  function fitSegment(buf, m, area, seg) {
    var aw = area.w, ah = area.h, xa = seg.a, xb = seg.b, sw = xb - xa + 1, x, y, i, k;
    /* rows: how much of the segment's width is not background */
    var rowN = new Float64Array(ah);
    for (y = 0; y < ah; y++) { k = 0; for (x = xa; x <= xb; x++) k += m[y * aw + x]; rowN[y] = k; }
    /* full-width lines (frame, tab dividers) are not item content */
    var line = new Uint8Array(ah);
    for (y = 0; y < ah; y++) if (rowN[y] > 0.85 * sw) line[y] = 1;
    /* vertical extent: the longest stretch that is not solid */
    var rowRuns = runs(Array.prototype.map.call(rowN, function (v, yy) { return line[yy] ? 0 : v; }), 1);
    /* columns: profile over the non-line rows, ignoring thin runs (tab labels) */
    var tall = rowRuns.filter(function (r) { return r.n >= 14; });
    if (!tall.length) return null;
    var colN = new Float64Array(sw), mx = 0;
    tall.forEach(function (r) { for (y = r.a; y <= r.b; y++) for (x = xa; x <= xb; x++) colN[x - xa] += m[y * aw + x]; });
    for (x = 0; x < sw; x++) if (colN[x] > mx) mx = colN[x];
    var colRuns = runs(colN, Math.max(1, 0.1 * mx)).filter(function (r) { return r.n >= 8; });
    if (colRuns.length < 3) return null;
    var diffs = [];
    for (i = 1; i < colRuns.length; i++) diffs.push(colRuns[i].c - colRuns[i - 1].c);
    var p = median(diffs);
    if (p < 24 || p > 160) return null;
    /* refine the pitch and offset by least squares on the column indices */
    var ks = [], cs = [];
    colRuns.forEach(function (r) { if (r.n <= 1.05 * p) { ks.push(Math.round((r.c - colRuns[0].c) / p)); cs.push(r.c); } });
    if (ks.length < 3) return null;
    var n = ks.length, sk = 0, sc = 0, skk = 0, skc = 0;
    for (i = 0; i < n; i++) { sk += ks[i]; sc += cs[i]; skk += ks[i] * ks[i]; skc += ks[i] * cs[i]; }
    var den = n * skk - sk * sk;
    if (den) { p = (n * skc - sk * sc) / den; }
    if (Math.abs(p - Math.round(p)) < 0.008 * p) p = Math.round(p);        /* slots are a whole number of pixels apart at the usual scales */
    var o = (sc - p * sk) / n, res = 0;
    for (i = 0; i < n; i++) res = Math.max(res, Math.abs(cs[i] - (o + p * ks[i])));
    if (res > 0.15 * p) return null;
    /* all columns that fit between the walls */
    while (o - p - p / 2 >= -0.12 * p) o -= p;
    var cols = [];
    for (x = o; x + p / 2 <= sw + 0.12 * p; x += p) cols.push(area.x + xa + x);
    if (cols.length < 6) return null;                                    /* the backpack has the same background; the bank is wider */

    /* rows: content runs about one slot tall, grouped into sections of evenly spaced rows */
    var rows = [], sections = [], cur = null;
    rowRuns.forEach(function (r) {
      if (r.n < 0.42 * p) return;
      var parts = r.n > 1.15 * p ? Math.round(r.n / p) : 1;
      for (var q = 0; q < parts; q++) {
        var c = parts === 1 ? r.c : r.a + (q + 0.5) * r.n / parts;
        var wide = widestBlob(m, aw, xa, xb, Math.round(c));
        if (wide > 1.25 * p) continue;                      /* a search box or button bar, not items */
        var clipped = r.a <= 1 || r.b >= ah - 2;
        if (cur && Math.abs(((c - cur.last) / p) - Math.round((c - cur.last) / p)) < 0.2 && (c - cur.last) < 3.5 * p) { cur.items.push({ c: c, clipped: clipped }); cur.last = c; }
        else { cur = { items: [{ c: c, clipped: clipped }], last: c }; sections.push(cur); }
      }
    });
    sections.forEach(function (s, si) {
      var c0 = s.items[0].c, offs = s.items.map(function (it) { return it.c - Math.round((it.c - c0) / p) * p; });
      var off = median(offs);
      s.items.forEach(function (it) { rows.push({ y: area.y + off + Math.round((it.c - c0) / p) * p, section: si, clipped: it.clipped }); });
    });
    if (!rows.length) return null;
    return { pitch: p, cols: cols, rows: rows, x: area.x + xa, y: area.y, w: sw, h: ah, residual: res };
  }
  function widestBlob(m, aw, xa, xb, y) {
    var best = 0, run = 0, gap = 0, x;
    for (x = xa; x <= xb; x++) {
      var hit = m[y * aw + x] || m[(y - 3) * aw + x] || m[(y + 3) * aw + x];
      if (hit) { run += gap + 1; gap = 0; if (run > best) best = run; }
      else if (run && gap < 3) gap++;
      else { run = 0; gap = 0; }
    }
    return best;
  }

  /* ---------- 3. slots and their canonical patches ---------- */
  function slotRect(grid, col, row) {
    var p = grid.pitch;
    return { x: Math.round(grid.cols[col] - p / 2), y: Math.round(grid.rows[row].y - p / 2), w: Math.round(p), h: Math.round(p) };
  }
  /* area-average the part of the slot below the stack number into PW x PH RGB */
  function patch(buf, grid, col, row, dx, dy) {
    /* whole-pixel origin: the same item then samples identically wherever it is on screen */
    var p = grid.pitch, x0 = Math.round(grid.cols[col] - p / 2 + SIDE * p) + (dx || 0), y0 = Math.round(grid.rows[row].y - p / 2 + NUM_BAND * p) + (dy || 0);
    var w = p * (1 - 2 * SIDE), h = p * (1 - NUM_BAND) - 0.04 * p;
    return resample(buf, x0, y0, w, h, PW, PH);
  }
  function resample(buf, x0, y0, w, h, ow, oh) {
    var W = buf.width, H = buf.height, d = buf.data, out = new Uint8Array(ow * oh * 3), i, j, x, y;
    for (j = 0; j < oh; j++) for (i = 0; i < ow; i++) {
      var xa = x0 + i * w / ow, xb = x0 + (i + 1) * w / ow, ya = y0 + j * h / oh, yb = y0 + (j + 1) * h / oh;
      var r = 0, g = 0, b = 0, t = 0;
      for (y = Math.floor(ya); y < yb; y++) {
        if (y < 0 || y >= H) continue;
        var wy = Math.min(y + 1, yb) - Math.max(y, ya);
        for (x = Math.floor(xa); x < xb; x++) {
          if (x < 0 || x >= W) continue;
          var wt = wy * (Math.min(x + 1, xb) - Math.max(x, xa)), q = (y * W + x) * 4;
          r += d[q] * wt; g += d[q + 1] * wt; b += d[q + 2] * wt; t += wt;
        }
      }
      var o = (j * ow + i) * 3;
      if (t) { out[o] = Math.round(r / t); out[o + 1] = Math.round(g / t); out[o + 2] = Math.round(b / t); }
      else { out[o] = BG[0]; out[o + 1] = BG[1]; out[o + 2] = BG[2]; }
    }
    return out;
  }
  /* the same patch at every small offset: the lattice is only good to a pixel or two, and the
     library compares a slot at all of these against its stored samples */
  function shiftedPatches(buf, grid, col, row) {
    var k = grid.pitch / 44, ry = Math.ceil(3 * k), rx = Math.ceil(2 * k), out = [], dx, dy;
    for (dy = -ry; dy <= ry; dy++) for (dx = -rx; dx <= rx; dx++) if (dx || dy) out.push(patch(buf, grid, col, row, dx, dy));
    return out;
  }
  /* how much of the patch is not background: empty slots are ~0 */
  function ink(pt) {
    var n = 0, i;
    for (i = 0; i < pt.length; i += 3) if (Math.abs(pt[i] - BG[0]) + Math.abs(pt[i + 1] - BG[1]) + Math.abs(pt[i + 2] - BG[2]) > 30) n++;
    return n / (pt.length / 3);
  }

  /* offX/offY: where this buffer sits in the full capture (slots are reported in capture coordinates) */
  /* Keep the lattice steady from one read to the next.  The fit comes from whatever items are
     visible, so a tooltip drawn over the bank nudges it by a pixel and hides whole rows; when
     most rows still line up with the previous read (the bank has not scrolled), reuse its
     columns and row positions, and keep the rows that are merely hidden behind the tooltip
     (band = its vertical extent).  prev and band are in this buffer's coordinates. */
  function stabilise(grid, prev, band) {
    if (!prev || Math.abs(prev.pitch - grid.pitch) > 0.01 || prev.cols.length !== grid.cols.length || Math.abs(prev.cols[0] - grid.cols[0]) > 2.5) return grid;
    var hit = 0, used = [];
    grid.rows.forEach(function (r) { for (var i = 0; i < prev.rows.length; i++) if (Math.abs(prev.rows[i].y - r.y) <= 2.5) { r.match = i; hit++; break; } });
    if (hit < Math.max(1, grid.rows.length / 2)) { grid.rows.forEach(function (r) { delete r.match; }); return grid; }
    grid.cols = prev.cols.slice();
    grid.rows.forEach(function (r) { if (r.match !== undefined) { used[r.match] = 1; r.y = prev.rows[r.match].y; r.section = prev.rows[r.match].section; delete r.match; } else r.section += 1000; });
    if (band) prev.rows.forEach(function (q, i) { if (!used[i] && !q.clipped && q.y + grid.pitch / 2 > band.y0 && q.y - grid.pitch / 2 < band.y1) grid.rows.push({ y: q.y, section: q.section, clipped: false, carried: true }); });
    grid.rows.sort(function (a, b) { return a.y - b.y; });
    return grid;
  }

  function readBuffer(buf, whole, offX, offY, prev, band) {
    var areas = whole ? [{ x: 0, y: 0, w: buf.width, h: buf.height }] : findAreas(buf), grid = null, i;
    offX = offX || 0; offY = offY || 0;
    for (i = 0; i < areas.length && i < 4 && !grid; i++) grid = fitGrid(buf, areas[i]);
    if (!grid) return { error: areas.length ? "no-grid" : "no-bank", areas: areas.length };
    if (prev) grid = stabilise(grid, { pitch: prev.pitch, cols: prev.cols.map(function (v) { return v - offX; }), rows: prev.rows.map(function (q) { return { y: q.y - offY, section: q.section, clipped: q.clipped }; }) },
      band ? { y0: band.y0 - offY, y1: band.y1 - offY } : null);
    var slots = [], r, c;
    for (r = 0; r < grid.rows.length; r++) {
      if (grid.rows[r].clipped) continue;
      for (c = 0; c < grid.cols.length; c++) {
        var pt = patch(buf, grid, c, r), k = ink(pt);
        if (k < 0.04) continue;
        var rect = slotRect(grid, c, r);
        slots.push({ shifts: shiftedPatches.bind(null, buf, grid, c, r), col: c, row: r, section: grid.rows[r].section, x: rect.x + offX, y: rect.y + offY, w: rect.w, h: rect.h, patch: pt, ink: k });
      }
    }
    /* report the grid in capture coordinates too (the closures above keep the buffer's own) */
    var g = { pitch: grid.pitch, residual: grid.residual, x: grid.x + offX, y: grid.y + offY, w: grid.w, h: grid.h,
      cols: grid.cols.map(function (v) { return v + offX; }), rows: grid.rows.map(function (q) { return { y: q.y + offY, section: q.section, clipped: q.clipped, carried: q.carried }; }) };
    return { grid: g, slots: slots, off: { x: offX, y: offY } };
  }

  /* Reading the whole game every time is slow, so once the bank is found only its own area
     (plus a margin, so resizing or moving it a little is followed) is read; if that stops
     looking like a bank the whole capture is searched again. */
  var lastArea = null, misses = 0;
  function read(prev, band) {
    if (!window.alt1) return { error: "no-alt1" };
    if (!alt1.permissionPixel) return { error: "no-permission" };
    if (!alt1.rsLinked) return { error: "no-rs" };
    var img = api._capture(), r = null, buf;
    if (!img) return { error: "no-capture" };
    if (lastArea) {
      var m = 48, x = Math.max(0, lastArea.x - m), y = Math.max(0, lastArea.y - m), w = Math.min(img.width - x, lastArea.w + 2 * m), h = Math.min(img.height - y, lastArea.h + 2 * m);
      buf = img.toData(img.x + x, img.y + y, w, h);
      r = readBuffer(buf, true, x, y, prev, band);
      if (r.error) { r = null; lastArea = null; }                 /* moved, resized or closed: look everywhere */
    }
    if (!r) {
      buf = img.toData(img.x, img.y, img.width, img.height);
      r = readBuffer(buf, false, 0, 0, prev, band);
    }
    if (!r.error) { lastArea = { x: r.grid.x, y: r.grid.y, w: r.grid.w, h: r.grid.h }; misses = 0; }
    r.img = img; r.buf = buf; r.captureSize = img.width + "x" + img.height;
    return r;
  }
  /* a piece of the game as a plain buffer (capture coordinates) */
  function grab(x, y, w, h) { var img = api._capture(); return img ? img.toData(img.x + x, img.y + y, w, h) : null; }
  function fullCapture() { var img = api._capture(); return img ? img.toData(img.x, img.y, img.width, img.height) : null; }
  function slotImage(buf, s, off) {
    off = off || { x: 0, y: 0 };
    var cv = document.createElement("canvas"); cv.width = s.w; cv.height = s.h;
    var cx = cv.getContext("2d"), id = cx.createImageData(s.w, s.h), x, y;
    for (y = 0; y < s.h; y++) for (x = 0; x < s.w; x++) {
      var sx = s.x - off.x + x, sy = s.y - off.y + y, q = (y * s.w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= buf.width || sy >= buf.height) continue;
      var p = (sy * buf.width + sx) * 4;
      id.data[q] = buf.data[p]; id.data[q + 1] = buf.data[p + 1]; id.data[q + 2] = buf.data[p + 2]; id.data[q + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return cv.toDataURL("image/png");
  }

  var api = {
    _capture: function () { return A1lib.captureHoldFullRs(); }, /* tests swap this out */
    PW: PW, PH: PH, BG: BG,
    findAreas: findAreas, fitGrid: fitGrid, readBuffer: readBuffer, read: read, grab: grab, fullCapture: fullCapture, reset: function () { lastArea = null; misses = 0; }, patch: patch, ink: ink, slotRect: slotRect, slotImage: slotImage, resample: resample
  };
  return api;
});
