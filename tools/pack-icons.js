/* Packs the wiki icon patches (wiki-icons.bin, 648 bytes = one 18x12 RGB picture per icon) into one PNG:
   a third of the size, and any browser unpacks it by drawing it on a canvas.
     node tools/pack-icons.js path/to/wiki-icons.json path/to/wiki-icons.bin
   writes data/wiki-icons.json (with the sheet's column count) and data/wiki-icons.png.
   The app's own "Download wiki-icons.png" button makes the same file without this script. */
var fs = require("fs"), path = require("path"), PNG = require("pngjs").PNG;
var CW = 18, CH = 12, BYTES = CW * CH * 3, COLS = 128;
var meta = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), bin = fs.readFileSync(process.argv[3]);
if (meta.bytes !== BYTES || bin.length !== meta.names.length * BYTES) throw new Error("the two files do not belong together: " + meta.names.length + " names, " + bin.length + " bytes");
var n = meta.names.length, rows = Math.ceil(n / COLS), png = new PNG({ width: COLS * CW, height: rows * CH, colorType: 2, inputHasAlpha: true }), i, x, y;
png.data.fill(0); for (i = 3; i < png.data.length; i += 4) png.data[i] = 255;
for (i = 0; i < n; i++) {
  var ox = (i % COLS) * CW, oy = Math.floor(i / COLS) * CH;
  for (y = 0; y < CH; y++) for (x = 0; x < CW; x++) { var s = i * BYTES + (y * CW + x) * 3, d = ((oy + y) * png.width + ox + x) * 4; png.data[d] = bin[s]; png.data[d + 1] = bin[s + 1]; png.data[d + 2] = bin[s + 2]; }
}
meta.cols = COLS;
var out = path.join(__dirname, "..", "data");
fs.writeFileSync(path.join(out, "wiki-icons.json"), JSON.stringify(meta));
fs.writeFileSync(path.join(out, "wiki-icons.png"), PNG.sync.write(png, { colorType: 2, inputHasAlpha: true, deflateLevel: 9, deflateStrategy: 0, filterType: 0 }));
console.log(n + " icons -> " + png.width + "x" + png.height + " PNG, " + fs.statSync(path.join(out, "wiki-icons.png")).size + " bytes");
