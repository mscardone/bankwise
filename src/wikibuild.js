/* Builds the wiki icon library, in the player's own browser (one-off, a few minutes).

   1. walks a wiki category of item pages, 50 pages per request, asking for the files each page uses
   2. keeps the files that picture that page's item (WikiLib.itemNameForFile)
   3. fetches each icon, turns it into an anchored patch
   The result is kept in IndexedDB for this computer and can be downloaded as two files
   (data/wiki-icons.json + data/wiki-icons.bin) to ship with the app for everyone else. */
(function (root) {
  "use strict";
  var API = "https://runescape.wiki/api.php", IMG = "https://runescape.wiki/images/";
  var DB = "bankwise", STORE = "wiki", KEY = "icons-v1";

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fileUrl(file) { return IMG + encodeURIComponent(String(file).replace(/^File:/i, "").replace(/ /g, "_")); }

  function loadIcon(file) {
    return new Promise(function (resolve) {
      var img = new Image(); img.crossOrigin = "anonymous";
      img.onerror = function () { resolve(null); };
      img.onload = function () {
        try {
          if (img.width > 40 || img.height > 36 || img.width < 4) return resolve(null);      /* not an inventory icon */
          var cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
          var cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
          resolve(WikiLib.iconPatch(cx.getImageData(0, 0, img.width, img.height).data, img.width, img.height));
        } catch (e) { resolve(null); }
      };
      img.src = fileUrl(file);
    });
  }

  /* opts: {category, onProgress(state), isCancelled(), onCheckpoint(lib)} -> Promise<{names, files, patches}>
     Listing and icon fetching run side by side: icons start arriving within seconds, Stop keeps
     whatever has been fetched at any point, and a checkpoint is handed out every 4000 icons so a
     closed window does not lose the lot. */
  function build(opts) {
    var cat = opts.category || "Items", wanted = [], seen = {}, next = 0, listed = false, failedList = null;
    var names = [], files = [], parts = [], lastCheckpoint = 0;
    var state = { phase: "working", pages: 0, files: 0, done: 0, kept: 0, failed: 0, listed: false };
    function cancelled() { return !!(opts.isCancelled && opts.isCancelled()); }
    function progress() { state.files = wanted.length; state.listed = listed; if (opts.onProgress) opts.onProgress(state); }
    function pack() {
      var patches = new Uint8Array(parts.length * WikiLib.BYTES);
      parts.forEach(function (p, i) { patches.set(p, i * WikiLib.BYTES); });
      return { names: names.slice(), files: files.slice(), patches: patches, category: cat, at: Date.now(), complete: listed && next >= wanted.length && !cancelled() };
    }
    function listAll(cont) {
      if (cancelled()) return Promise.resolve();
      var url = API + "?action=query&format=json&origin=*&generator=categorymembers&gcmtitle=" + encodeURIComponent("Category:" + cat) + "&gcmnamespace=0&gcmlimit=50&prop=images&imlimit=500", k;
      for (k in (cont || {})) url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(cont[k]);
      return fetch(url).then(function (r) { if (!r.ok) throw new Error("wiki said HTTP " + r.status); return r.json(); }).then(function (j) {
        if (j.error) throw new Error("wiki: " + (j.error.info || j.error.code));
        var pages = j.query && j.query.pages || {}, id;
        for (id in pages) {
          var pg = pages[id]; if (!cont || !cont.imcontinue) state.pages++;
          (pg.images || []).forEach(function (im) {
            var nm = WikiLib.itemNameForFile(im.title, pg.title);
            if (nm && !seen[im.title]) { seen[im.title] = 1; wanted.push({ file: im.title.replace(/^File:/i, ""), name: nm }); }
          });
        }
        progress();
        if (j["continue"]) return wait(40).then(function () { return listAll(j["continue"]); });
      });
    }
    function worker() {
      if (cancelled()) return Promise.resolve();
      if (next >= wanted.length) return listed ? Promise.resolve() : wait(250).then(worker);      /* wait for the list to grow */
      var w = wanted[next++];
      return loadIcon(w.file).then(function (pt) {
        state.done++;
        if (pt) { names.push(w.name); files.push(w.file); parts.push(pt); state.kept++; } else state.failed++;
        if (state.done % 25 === 0) progress();
        if (opts.onCheckpoint && parts.length - lastCheckpoint >= 4000) { lastCheckpoint = parts.length; try { opts.onCheckpoint(pack()); } catch (e) { /* best effort */ } }
        return worker();
      });
    }
    var listing = listAll(null).catch(function (e) { failedList = e; }).then(function () { listed = true; progress(); });
    var pool = [listing]; for (var i = 0; i < 10; i++) pool.push(worker());
    return Promise.all(pool).then(function () {
      if (!parts.length) throw (failedList || new Error("the category \"" + cat + "\" gave no item icons (" + state.pages + " pages looked at) - is the category name right?"));
      state.phase = cancelled() ? "stopped" : "finished"; progress();
      var out = pack(); if (failedList) out.note = "the item list stopped early: " + failedList.message;
      return out;
    });
  }

  /* ---------- keeping it: IndexedDB here, two files for the repo ---------- */
  function idb() {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { resolve(rq.result); }; rq.onerror = function () { reject(rq.error); };
    });
  }
  function save(lib) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(lib, KEY); tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function loadLocal() { return idb().then(function (db) { return new Promise(function (res) { var rq = db.transaction(STORE).objectStore(STORE).get(KEY); rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
  function clearLocal() { return idb().then(function (db) { return new Promise(function (res) { var tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE)["delete"](KEY); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; }); }).catch(function () { return false; }); }
  /* The patches travel as one PNG sheet (a third of the size of the raw bytes): icon i is the 18x12 tile
     at column i % cols, row floor(i / cols).  A PNG without transparency comes back off a canvas byte for byte. */
  var SHEET_COLS = 128;
  function sheetCanvas(lib) {
    var n = lib.names.length, cols = SHEET_COLS, cw = WikiLib.CW, ch = WikiLib.CH, cv = document.createElement("canvas");
    cv.width = cols * cw; cv.height = Math.ceil(n / cols) * ch;
    var cx = cv.getContext("2d"), id = cx.createImageData(cv.width, cv.height), d = id.data, i, x, y;
    for (i = 3; i < d.length; i += 4) d[i] = 255;
    for (i = 0; i < n; i++) {
      var ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
      for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) { var s = i * WikiLib.BYTES + (y * cw + x) * 3, q = ((oy + y) * cv.width + ox + x) * 4; d[q] = lib.patches[s]; d[q + 1] = lib.patches[s + 1]; d[q + 2] = lib.patches[s + 2]; }
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }
  function loadSheet(url, n, cols) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onerror = function () { resolve(null); };
      img.onload = function () {
        try {
          var cw = WikiLib.CW, ch = WikiLib.CH;
          if (img.width !== cols * cw || img.height < Math.ceil(n / cols) * ch) return resolve(null);
          var cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
          var cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
          var d = cx.getImageData(0, 0, cv.width, cv.height).data, out = new Uint8Array(n * WikiLib.BYTES), i, x, y;
          for (i = 0; i < n; i++) {
            var ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
            for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) { var q = ((oy + y) * cv.width + ox + x) * 4, s = i * WikiLib.BYTES + (y * cw + x) * 3; out[s] = d[q]; out[s + 1] = d[q + 1]; out[s + 2] = d[q + 2]; }
          }
          resolve(out);
        } catch (e) { resolve(null); }
      };
      img.src = url;
    });
  }
  function loadShipped(version) {
    return fetch("./data/wiki-icons.json?v=" + version).then(function (r) { return r.ok ? r.json() : null; }).then(function (meta) {
      if (!meta || meta.v !== 1 || meta.bytes !== WikiLib.BYTES || !meta.names || !meta.names.length) return null;
      return loadSheet("./data/wiki-icons.png?v=" + version + "-" + meta.at, meta.names.length, meta.cols || SHEET_COLS).then(function (patches) {
        if (patches) return { names: meta.names, files: meta.files, patches: patches, category: meta.category, at: meta.at };
        return loadBin(version, meta);      /* an older data folder: the raw bytes */
      });
    }).catch(function () { return null; });
  }
  function loadBin(version, meta) {
      return fetch("./data/wiki-icons.bin?v=" + version + "-" + meta.at).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (ab) {
        if (!ab || ab.byteLength !== meta.names.length * WikiLib.BYTES) return null;
        return { names: meta.names, files: meta.files, patches: new Uint8Array(ab), category: meta.category, at: meta.at };
      }).catch(function () { return null; });
  }
  /* one file per click: a second download started by script is silently dropped by Alt1's browser */
  function download(lib, which) {
    function give(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    if (which === "png") sheetCanvas(lib).toBlob(function (blob) { give(blob, "wiki-icons.png"); }, "image/png");
    else give(new Blob([JSON.stringify({ v: 1, bytes: WikiLib.BYTES, cols: SHEET_COLS, category: lib.category, at: lib.at, names: lib.names, files: lib.files })], { type: "application/json" }), "wiki-icons.json");
  }

  root.WikiBuild = { build: build, save: save, loadLocal: loadLocal, loadShipped: loadShipped, clearLocal: clearLocal, download: download, _sheetCanvas: sheetCanvas, _loadSheet: loadSheet, fileUrl: fileUrl };
})(this);
