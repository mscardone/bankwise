/* Finding and reading the game's item tooltip.

   Alt1's stock tooltip finder looks for a pure black box; since the 2026 interface the
   tooltip is a very dark brown (15,14,12) box with a thin border, so it is found here
   instead: the largest solidly dark rectangle near the mouse.  Its first line reads
   "<action> <item name>" with the item name in its own colour, and Alt1's chat fonts
   read that name.  Pure functions on a plain {width,height,data} buffer. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.TipReader = factory(root.OCR, root.Alt1Fonts && root.Alt1Fonts.chatbox);
})(this, function (OCR, FONTS) {
  "use strict";
  var DARK = [15, 14, 12], TOL = 8;
  /* item-name colours: members' items, free items, and the near-white used for some untradeables */
  var NAME_COLOURS = [[248, 213, 107], [184, 209, 209]];
  var SIZES = ["14pt", "12pt", "16pt", "18pt"], lastSize = null;

  function isDark(d, p) { return Math.abs(d[p] - DARK[0]) + Math.abs(d[p + 1] - DARK[1]) + Math.abs(d[p + 2] - DARK[2]) <= TOL; }

  /* -> {x,y,width,height} of the tooltip box near the mouse, or null */
  function findBox(buf, mx, my) {
    var W = buf.width, H = buf.height, d = buf.data;
    var rx0 = Math.max(0, mx - 460), rx1 = Math.min(W - 1, mx + 460), ry0 = Math.max(0, my - 420), ry1 = Math.min(H - 1, my + 420);
    var rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1, m = new Uint8Array(rw * rh), x, y;
    for (y = 0; y < rh; y++) for (x = 0; x < rw; x++) if (isDark(d, ((ry0 + y) * W + rx0 + x) * 4)) m[y * rw + x] = 1;
    var best = null, boxes = [], stack = [], sx, sy;
    for (sy = 4; sy < rh; sy += 8) for (sx = 4; sx < rw; sx += 8) {
      if (m[sy * rw + sx] !== 1) continue;
      var x0 = sx, x1 = sx, y0 = sy, y1 = sy, n = 0;
      stack.length = 0; stack.push(sy * rw + sx); m[sy * rw + sx] = 2;
      while (stack.length) {
        var i = stack.pop(), cx = i % rw, cy = (i - cx) / rw; n++;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        if (cx > 0 && m[i - 1] === 1) { m[i - 1] = 2; stack.push(i - 1); }
        if (cx < rw - 1 && m[i + 1] === 1) { m[i + 1] = 2; stack.push(i + 1); }
        if (cy > 0 && m[i - rw] === 1) { m[i - rw] = 2; stack.push(i - rw); }
        if (cy < rh - 1 && m[i + rw] === 1) { m[i + rw] = 2; stack.push(i + rw); }
      }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw < 60 || bh < 16 || bw > 450 || n < 0.6 * bw * bh) continue;          /* a box, mostly filled (text is the rest) */
      if (x0 === 0 || y0 === 0 || x1 === rw - 1 || y1 === rh - 1) continue;         /* runs off the search area: not a tooltip */
      var box = { x: rx0 + x0, y: ry0 + y0, width: bw, height: bh, n: n };
      boxes.push(box);
      if (!best || n > best.n) best = box;
    }
    if (!best) return null;
    /* the tooltip is a stack of panels split by thin rules (name / stats / "+8 options"):
       the name is in the top one, so climb from the biggest panel to the one above it */
    var top = best, moved = true, whole = { x: best.x, y: best.y, x1: best.x + best.width, y1: best.y + best.height };
    while (moved) {
      moved = false;
      boxes.forEach(function (b) {
        if (b === top || Math.abs(b.x - top.x) > 4 || Math.abs(b.x + b.width - top.x - top.width) > 4) return;
        var gap = top.y - (b.y + b.height);
        if (gap >= 0 && gap <= 8) { top = b; moved = true; }
      });
    }
    boxes.forEach(function (b) { if (Math.abs(b.x - best.x) <= 4 && Math.abs(b.width - best.width) <= 8) { whole.y = Math.min(whole.y, b.y); whole.y1 = Math.max(whole.y1, b.y + b.height); } });
    return { x: top.x, y: top.y, width: top.width, height: top.height, whole: { x: whole.x, y: whole.y, width: whole.x1 - whole.x, height: whole.y1 - whole.y } };
  }

  /* The text colours actually present on the name line, most common first.  The game colours an
     item's name by what kind of item it is (gold here, but it varies), so the colour is measured,
     not assumed: bright pixels are grouped by hue/shade and each group's brightest pixel is the
     colour the font reader is given. */
  function textColours(buf, box) {
    var groups = {}, x, y, y1 = Math.min(box.y + box.height - 2, box.y + 22);
    for (y = box.y + 2; y <= y1; y++) for (x = box.x + 3; x < box.x + box.width - 3; x++) {
      var p = (y * buf.width + x) * 4, r = buf.data[p], g = buf.data[p + 1], b = buf.data[p + 2], mx = Math.max(r, g, b);
      if (mx < 150) continue;
      var k = Math.round(r / mx * 6) + "," + Math.round(g / mx * 6) + "," + Math.round(b / mx * 6), e = groups[k] || (groups[k] = { n: 0, best: 0, col: null, x0: x, x1: x });
      e.n++; if (x < e.x0) e.x0 = x; if (x > e.x1) e.x1 = x;
      if (r + g + b > e.best) { e.best = r + g + b; e.col = [r, g, b]; }
    }
    return Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (e) { return e.n >= 12; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
  }
  /* The action words ("Withdraw-All") are drawn in a warm off-white (227,215,207); item names are
     not.  Pieces are told apart by that colour, never by their words - "Clean guam" and "Light orb"
     are item names that start with a verb.  Only when the whole line is off-white is a leading
     Withdraw-/Deposit- word cut by its spelling. */
  function isActionColour(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 40 && c[0] >= c[2] + 8; }
  function stripAction(text) {
    var w = String(text || "").replace(/\s+/g, " ").trim().split(" ");
    while (w.length > 0 && /^(withdraw|deposit)(-[A-Za-z0-9]+)?$/i.test(w[0])) w.shift();
    return w.join(" ");
  }

  /* The first line is "<action> <item name>", the two parts in different colours (and the name's
     colour depends on the item: gold for members' items, pale cyan for free ones, maybe others).
     Every colour on the line is read separately, the pieces are put back in left-to-right order,
     and the action words are dropped - so it does not matter which colour the name is in. */
  function readName(buf, box) {
    if (!OCR || !FONTS) return { text: "", why: "ocr or fonts not loaded" };
    var order = lastSize ? [lastSize].concat(SIZES.filter(function (s) { return s !== lastSize; })) : SIZES, tried = [], si, y, k;
    var cols = textColours(buf, box);
    if (!cols.length) NAME_COLOURS.forEach(function (c) { cols.push({ col: c, x0: box.x, x1: box.x + box.width, n: 0 }); });
    for (si = 0; si < order.length; si++) {
      var font = FONTS[order[si]]; if (!font) continue;
      font = font.default || font;
      var parts = [];
      cols.forEach(function (e) {
        var best = null;
        for (y = box.y + 8; y <= box.y + 16 && !best; y += 2) for (k = 0; k < 3 && !best; k++) {
          var x = Math.round(e.x0 + (e.x1 - e.x0) * [0.5, 0.8, 0.2][k]), r = null;
          try { r = OCR.findReadLine(buf, font, [e.col], x, y); } catch (err) { tried.push(order[si] + ": " + err.message); return; }
          if (r && r.text && (r.text.match(/[A-Za-z]/g) || []).length >= 2) best = { text: r.text.replace(/\s+/g, " ").trim(), x: r.debugArea ? r.debugArea.x : e.x0, col: e.col };
        }
        if (best && !parts.some(function (q) { return q.text === best.text && Math.abs(q.x - best.x) < 4; })) parts.push(best);
      });
      if (!parts.length) continue;
      parts.sort(function (p, q) { return p.x - q.x; });
      var line = parts.map(function (q) { return q.text; }).join(" "), named = parts.filter(function (q) { return !isActionColour(q.col); });
      var name = named.length ? named.map(function (q) { return q.text; }).join(" ") : stripAction(line);
      if (named.length) parts = named;
      if (name.length < 3) { tried.push(order[si] + ": only read " + JSON.stringify(line)); continue; }
      /* the name's own colour = the colour of the right-most piece */
      lastSize = order[si];
      return { text: name, line: line, font: order[si], colour: parts[parts.length - 1].col };
    }
    return { text: "", why: "could not read a name on the first line" + (tried.length ? " (" + tried.join("; ") + ")" : "") };
  }
  /* brightest colours on the first line - for the debug panel when the name does not read */
  function lineColours(buf, box) {
    var seen = {}, x, y;
    for (y = box.y + 3; y < Math.min(box.y + 20, box.y + box.height); y++) for (x = box.x + 3; x < box.x + box.width - 3; x++) {
      var p = (y * buf.width + x) * 4, r = buf.data[p], g = buf.data[p + 1], b = buf.data[p + 2];
      if (Math.max(r, g, b) < 170) continue;
      var k = (r >> 3 << 3) + "," + (g >> 3 << 3) + "," + (b >> 3 << 3); seen[k] = (seen[k] || 0) + 1;
    }
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; }).slice(0, 4).map(function (k) { return k + " x" + seen[k]; });
  }
  function read(buf, mx, my) {
    var box = findBox(buf, mx, my);
    if (!box) return null;
    var name = readName(buf, box);
    return { area: box, text: name.text, line: name.line, font: name.font, colour: name.colour, why: name.why, colours: name.text ? null : lineColours(buf, box) };
  }
  return { findBox: findBox, readName: readName, read: read, lineColours: lineColours, stripAction: stripAction };
});
