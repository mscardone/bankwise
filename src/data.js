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
    return p ? { price: p[0], alch: p[1], value: p[2] } : null;
  }
  function pricesLoaded() { return !!prices; }

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
      tradeable: p ? true : (pricesLoaded() ? false : null),
      known: !!(f && !f.missing), cats: f ? f.cats : [],
      diango: has(f, /diango/i),
      questItem: has(f, /^quest items?$/i) || has(f, /quest items/i),
      wikiTitle: f && f.title || name
    };
  }

  loadFacts();
  return {
    loadPrices: loadPrices, price: price, pricesLoaded: pricesLoaded, factsFor: factsFor, describe: describe, status: status,
    onChange: function (f) { listeners.push(f); }, key: key,
    clearCache: function () { facts = {}; saveFacts(); prices = null; pricesAt = 0; store.set("bankwise.prices.v1", "null"); },
    _parseDump: parseDump, _collect: collect, _facts: function () { return facts; }
  };
});
