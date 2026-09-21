/* Reading the stack size drawn in the top-left of a bank slot.

   The game draws it in a fixed 8-pixel-tall pixel font, always at the same place in the slot,
   in a colour that carries the unit: yellow = the number itself, white = thousands ("123K"),
   green = millions ("91M").  At the normal interface scale the glyphs are pixel-exact, so each
   digit is matched column by column against its bitmap (bit 0 = top row).  The K / M letter is
   not needed - the colour says which it is.  Anything that does not read cleanly gives null
   (unknown), never a guess; a slot with no number holds exactly one item.
   Only the 100% interface scale (44px slots) is supported so far. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Stack = factory();
})(this, function () {
  "use strict";
  var DIGITS = { "0": [60, 66, 129, 66, 60], "1": [130, 255, 128], "2": [194, 161, 145, 137, 134], "3": [66, 137, 137, 118], "4": [63, 32, 248, 32],
    "5": [79, 137, 137, 113], "6": [124, 146, 137, 137, 114], "7": [193, 49, 13, 3], "8": [118, 137, 137, 137, 118], "9": [6, 9, 17, 17, 254] };
  var KEYS = Object.keys(DIGITS);

  function kind(r, g, b) { if (r > 240 && g > 240 && b < 40) return "y"; if (r > 240 && g > 240 && b > 240) return "w"; if (r < 60 && g > 240 && b < 40) return "g"; return ""; }

  /* slot = {x,y,w,h} in capture coordinates, off = where buf sits in the capture
     -> {qty, text, unit} | {qty: 1} when there is no number | null when it cannot be read */
  function read(buf, slot, off) {
    if (Math.abs(slot.w - 44) > 0.5) return null;
    off = off || { x: 0, y: 0 };
    var W = buf.width, d = buf.data, sx = slot.x - off.x, sy = slot.y - off.y, x, y, p, top = -1, colour = "";
    if (sx < 0 || sy < 0 || sx + slot.w > W || sy + 24 > buf.height) return null;
    /* the first glyph starts 5-10 px in from the slot's left edge; its top row is the number's top row */
    for (y = 4; y < 14 && top < 0; y++) for (x = 5; x < 12; x++) { p = ((sy + y) * W + sx + x) * 4; var k = kind(d[p], d[p + 1], d[p + 2]); if (k) { top = y; colour = k; break; } }
    if (top < 0) return { qty: 1, text: "", unit: "" };
    var cols = [];
    for (x = 4; x < slot.w; x++) { var bits = 0; for (y = 0; y < 8; y++) { p = ((sy + top + y) * W + sx + x) * 4; if (kind(d[p], d[p + 1], d[p + 2]) === colour) bits |= 1 << y; } cols.push(bits); }
    var i = 0, text = "", gap = 0;
    while (i < cols.length) {
      if (!cols[i]) { i++; if (text && ++gap > 3) break; continue; }        /* a wide gap after digits: the number is over */
      gap = 0;
      var hit = null;
      for (var t = 0; t < KEYS.length && !hit; t++) { var g = DIGITS[KEYS[t]], ok = i + g.length <= cols.length; for (var c = 0; ok && c < g.length; c++) if (cols[i + c] !== g[c]) ok = false; if (ok) hit = KEYS[t]; }
      if (!hit) break;
      text += hit; i += DIGITS[hit].length;
    }
    if (!text) return null;
    /* whatever is left must be the unit letter (white K / green M) or nothing at all */
    var rest = 0; for (; i < cols.length && rest < 12; i++) if (cols[i]) rest++;
    if (colour === "y" && rest) return null;
    var n = parseInt(text, 10);
    return { qty: colour === "w" ? n * 1000 : colour === "g" ? n * 1000000 : n, text: text + (colour === "w" ? "K" : colour === "g" ? "M" : ""), unit: colour === "w" ? "K" : colour === "g" ? "M" : "", approx: colour !== "y" };
  }
  return { read: read, DIGITS: DIGITS };
});
