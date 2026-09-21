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

  /* opts: {category, onProgress(state), isCancelled()} -> Promise<{names, files, patches}> */
  function build(opts) {
    var cat = opts.category || "Items", wanted = [], seen = {}, state = { phase: "listing", pages: 0, files: 0, done: 0, kept: 0, failed: 0, note: "" };
    function progress() { if (opts.onProgress) opts.onProgress(state); }
    function listAll(cont) {
      if (opts.isCancelled && opts.isCancelled()) return Promise.resolve();
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
        state.files = wanted.length; progress();
        if (j["continue"]) return wait(120).then(function () { return listAll(j["continue"]); });
      });
    }
    return listAll(null).then(function () {
      if (!wanted.length) throw new Error("the category \"" + cat + "\" gave no item icons (" + state.pages + " pages looked at) - is the category name right?");
      state.phase = "icons"; progress();
      var names = [], files = [], parts = [], next = 0;
      function worker() {
        if (next >= wanted.length || (opts.isCancelled && opts.isCancelled())) return Promise.resolve();
        var w = wanted[next++];
        return loadIcon(w.file).then(function (pt) {
          state.done++;
          if (pt) { names.push(w.name); files.push(w.file); parts.push(pt); state.kept++; } else state.failed++;
          if (state.done % 25 === 0) progress();
          return worker();
        });
      }
      var pool = []; for (var i = 0; i < 6; i++) pool.push(worker());
      return Promise.all(pool).then(function () {
        var patches = new Uint8Array(parts.length * WikiLib.BYTES);
        parts.forEach(function (p, i2) { patches.set(p, i2 * WikiLib.BYTES); });
        state.phase = (opts.isCancelled && opts.isCancelled()) ? "stopped" : "finished"; progress();
        return { names: names, files: files, patches: patches, category: cat, at: Date.now() };
      });
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
  function loadShipped(version) {
    return fetch("./data/wiki-icons.json?v=" + version).then(function (r) { return r.ok ? r.json() : null; }).then(function (meta) {
      if (!meta || meta.v !== 1 || meta.bytes !== WikiLib.BYTES || !meta.names || !meta.names.length) return null;
      return fetch("./data/wiki-icons.bin?v=" + version + "-" + meta.at).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (ab) {
        if (!ab || ab.byteLength !== meta.names.length * WikiLib.BYTES) return null;
        return { names: meta.names, files: meta.files, patches: new Uint8Array(ab), category: meta.category, at: meta.at };
      });
    }).catch(function () { return null; });
  }
  function download(lib) {
    function give(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    give(new Blob([JSON.stringify({ v: 1, bytes: WikiLib.BYTES, category: lib.category, at: lib.at, names: lib.names, files: lib.files })], { type: "application/json" }), "wiki-icons.json");
    setTimeout(function () { give(new Blob([lib.patches], { type: "application/octet-stream" }), "wiki-icons.bin"); }, 600);
  }

  root.WikiBuild = { build: build, save: save, loadLocal: loadLocal, loadShipped: loadShipped, clearLocal: clearLocal, download: download, fileUrl: fileUrl };
})(this);
