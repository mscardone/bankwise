/* Item facts from the RuneScape Wiki, fetched by the player's own browser and cached.

   prices : the wiki's Grand Exchange dump (one file, every tradeable item), refreshed daily
   facts  : the wiki page's categories for an item, fetched the first time the item is seen
            (50 names per request) - Diango-reclaimable, quest item, what kind of item it is

   Nothing here is needed for the app to run: every call degrades to "unknown", and the
   debug panel shows what each source last answered. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Data = factory();
})(this, function () {
  "use strict";
  var PRICE_URL = "https://chisel.weirdgloop.org/gazproj/gazbot/rs_dump.json";
  var PRICE_ONE = "https://api.weirdgloop.org/exchange/history/rs/latest?name=";
  var WIKI_API = "https://runescape.wiki/api.php";
  var DAY = 24 * 3600 * 1000;
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } } };

  var prices = null, pricesAt = 0, facts = {}, pending = {}, queue = [], timer = null, listeners = [];
  var status = { prices: "not loaded", facts: "idle", lastError: "" };

  function key(name) { return String(name || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function changed() { listeners.forEach(function (f) { try { f(); } catch (e) { /* ui only */ } }); }

  /* ---------- prices ---------- */
  function parseDump(j) {
    var out = {}, n = 0, id;
    for (id in j) {
      var it = j[id];
      if (!it || typeof it !== "object" || !it.name) continue;
      out[key(it.name)] = [+it.price || 0, +it.highalch || 0, +it.value || 0];
      n++;
    }
    return n ? out : null;
  }
  function loadPrices(force) {
    if (!prices) {
      try { var c = JSON.parse(store.get("bankwise.prices.v1") || "null"); if (c && c.p) { prices = c.p; pricesAt = c.at; status.prices = Object.keys(prices).length + " items (cached)"; } } catch (e) { /* refetch */ }
    }
    if (prices && !force && Date.now() - pricesAt < DAY) return Promise.resolve(true);
    status.prices = prices ? status.prices + ", refreshing" : "loading";
    return fetch(PRICE_URL).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      var p = parseDump(j);
      if (!p) throw new Error("price file had no items");
      prices = p; pricesAt = Date.now();
      store.set("bankwise.prices.v1", JSON.stringify({ at: pricesAt, p: p }));
      status.prices = Object.keys(p).length + " items (fresh)";
      changed(); return true;
    }).catch(function (e) { status.prices = (prices ? Object.keys(prices).length + " items (stale) - " : "unavailable - ") + e.message; status.lastError = "prices: " + e.message; changed(); return false; });
  }
  /* -> {price, alch, value} or null when the item is not on the Grand Exchange (or prices are not loaded) */
  function price(name) {
    var p = prices && prices[key(name)];
    if (p) return { price: p[0], alch: p[1], value: p[2] };
    var o = one[key(name)];
    if (!prices && !o && name && !onePending[key(name)]) { onePending[key(name)] = 1; oneQueue.push(name); if (!oneTimer) oneTimer = setTimeout(flushOne, 500); }
    return o && o.price !== null ? { price: o.price, alch: 0, value: 0 } : null;
  }
  /* true once we can tell "not on the Grand Exchange" from "don't know yet" for this item */
  function pricesLoaded(name) { return !!prices || !!(name && one[key(name)]); }

  /* fallback when the one-file dump cannot be fetched: ask the exchange API item by item (50 per request) */
  var one = {}, onePending = {}, oneQueue = [], oneTimer = null;
  function flushOne() {
    oneTimer = null;
    var batch = oneQueue.splice(0, 50);
    if (!batch.length) return;
    fetch(PRICE_ONE + encodeURIComponent(batch.join("|"))).then(function (r) { return r.json(); }).then(function (j) {
      var byKey = {}, n;
      for (n in (j || {})) if (j[n] && typeof j[n] === "object") byKey[key(n)] = j[n];
      batch.forEach(function (nm) { var k = key(nm), hit = byKey[k]; one[k] = { price: hit && hit.price !== undefined ? +hit.price : null }; delete onePending[k]; });
      status.prices = "item-by-item: " + Object.keys(one).length + " looked up (the one-file dump was unavailable)";
      changed();
      if (oneQueue.length) oneTimer = setTimeout(flushOne, 1000);
    }).catch(function (e) { batch.forEach(function (nm) { delete onePending[key(nm)]; }); status.lastError = "item prices: " + e.message; });
  }

  /* debug: fetch each source once and report exactly what came back */
  function selfTest() {
    var urls = [["price dump", PRICE_URL], ["price, one item", PRICE_ONE + encodeURIComponent("Magic logs|Santa hat")],
      ["wiki categories", WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=categories&cllimit=max&clshow=!hidden&titles=" + encodeURIComponent("Magic logs|Santa hat|Commorb")]];
    return Promise.all(urls.map(function (u) {
      return fetch(u[1]).then(function (r) { return r.text().then(function (t) { return u[0] + ": HTTP " + r.status + ", " + t.length + " chars\n    " + t.slice(0, u[0] === "wiki categories" ? 1500 : 400).replace(/\s+/g, " "); }); })
        .catch(function (e) { return u[0] + ": FAILED - " + e.message + "\n    " + u[1]; });
    }));
  }

  /* ---------- does the wiki know this name?  if not, is there one an l/i swap away? ---------- */
  function variants(name) {
    var pos = [], out = [], i, j;
    for (i = 0; i < name.length; i++) if (/[ilI]/.test(name[i])) pos.push(i);
    function swap(str, k) { var ch = str[k], to = ch === "i" ? "l" : ch === "l" ? "i" : ch === "I" ? "l" : ch; return str.slice(0, k) + to + str.slice(k + 1); }
    for (i = 0; i < pos.length; i++) out.push(swap(name, pos[i]));                       /* one letter wrong first... */
    for (i = 0; i < pos.length; i++) for (j = i + 1; j < pos.length && out.length < 30; j++) out.push(swap(swap(name, pos[i]), pos[j]));   /* ...then two */
    return out;
  }
  function resolveName(name) {
    var vs = variants(name);
    if (!vs.length) return Promise.resolve(null);
    var titles = [name].concat(vs), url = WIKI_API + "?action=query&format=json&origin=*&redirects=1&titles=" + encodeURIComponent(titles.join("|"));
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var q = j && j.query || {}, fwd = {}, exists = {}, id;
      (q.normalized || []).concat(q.redirects || []).forEach(function (r) { fwd[r.from] = r.to; });
      for (id in (q.pages || {})) if (q.pages[id].missing === undefined && q.pages[id].invalid === undefined) exists[q.pages[id].title] = 1;
      function final(t) { var g = 0; while (fwd[t] && g++ < 4) t = fwd[t]; return t; }
      if (exists[final(name)]) return null;
      for (var i = 0; i < vs.length; i++) if (exists[final(vs[i])]) return vs[i];
      return null;
    }).catch(function () { return null; });
  }

  /* ---------- facts (wiki categories) ---------- */
  function loadFacts() { try { facts = JSON.parse(store.get("bankwise.facts.v1") || "{}") || {}; } catch (e) { facts = {}; } }
  function saveFacts() { store.set("bankwise.facts.v1", JSON.stringify(facts)); }
  function factsFor(name) {
    var k = key(name), f = facts[k];
    if (f && Date.now() - f.at < 30 * DAY) return f;
    if (!pending[k] && name) { pending[k] = 1; queue.push(name); if (!timer) timer = setTimeout(flush, 400); }
    return f || null;
  }
  function flush() {
    timer = null;
    var batch = queue.splice(0, 40);
    if (!batch.length) return;
    status.facts = "asking the wiki about " + batch.length + " item" + (batch.length === 1 ? "" : "s");
    var url = WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=categories&cllimit=max&clshow=!hidden&titles=" + encodeURIComponent(batch.join("|"));
    fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) { return collect(j, url, batch, 0); }).then(function () {
      batch.forEach(function (n) { var k = key(n); delete pending[k]; if (!facts[k]) facts[k] = { at: Date.now(), cats: [], missing: true }; });
      saveFacts(); status.facts = Object.keys(facts).length + " items known"; changed();
      if (queue.length) timer = setTimeout(flush, 1200);
    }).catch(function (e) {
      batch.forEach(function (n) { delete pending[key(n)]; });
      status.facts = "wiki unavailable - " + e.message; status.lastError = "facts: " + e.message; changed();
    });
  }
  function collect(j, url, batch, depth) {
    var q = j && j.query || {}, back = {}, id;
    (q.normalized || []).concat(q.redirects || []).forEach(function (r) { back[r.to] = back[r.from] || r.from; });
    for (id in (q.pages || {})) {
      var pg = q.pages[id], from = pg.title, guard = 0;
      while (back[from] && guard++ < 4) from = back[from];
      var k = key(from), f = facts[k] && facts[k].fresh ? facts[k] : (facts[k] = { at: Date.now(), cats: [], fresh: 1 });
      f.title = pg.title; f.missing = pg.missing !== undefined;
      (pg.categories || []).forEach(function (c) { var t = String(c.title).replace(/^Category:/, ""); if (f.cats.indexOf(t) < 0) f.cats.push(t); });
    }
    if (j && j["continue"] && depth < 4) {
      var more = url, c;
      for (c in j["continue"]) more += "&" + c + "=" + encodeURIComponent(j["continue"][c]);
      return fetch(more).then(function (r) { return r.json(); }).then(function (j2) { return collect(j2, url, batch, depth + 1); });
    }
    for (id in facts) delete facts[id].fresh;
    return true;
  }
  function has(f, re) { return !!(f && f.cats && f.cats.some(function (c) { return re.test(c); })); }

  /* -> what the rest of the app needs to know about an item */
  function describe(name) {
    var f = factsFor(name), p = price(name);
    return {
      name: name, price: p ? p.price : null, alch: p ? p.alch : null,
      tradeable: p ? true : (pricesLoaded(name) ? false : null),
      known: !!(f && !f.missing), cats: f ? f.cats : [],
      diango: has(f, /diango/i),
      questItem: has(f, /^quest items?$/i) || has(f, /quest items/i),
      wikiTitle: f && f.title || name
    };
  }

  loadFacts();
  return {
    loadPrices: loadPrices, selfTest: selfTest, resolveName: resolveName, _variants: variants, price: price, pricesLoaded: pricesLoaded, factsFor: factsFor, describe: describe, status: status,
    onChange: function (f) { listeners.push(f); }, key: key,
    clearCache: function () { facts = {}; saveFacts(); prices = null; pricesAt = 0; store.set("bankwise.prices.v1", "null"); },
    _parseDump: parseDump, _collect: collect, _facts: function () { return facts; }
  };
});
