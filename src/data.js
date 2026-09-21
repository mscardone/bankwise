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
  /* the same figures as pages on the wiki itself, which answers from inside Alt1 where the dump does not:
     name -> number tables kept by the wiki's Grand Exchange bot (prices, high alchemy, shop value) */
  var BULK_PAGES = { price: "Module:GEPrices/data.json", alch: "Module:GEHighAlchs/data.json", value: "Module:GEValues/data.json" };
  var PRICE_ONE = "https://api.weirdgloop.org/exchange/history/rs/latest?name=";
  var WIKI_API = "https://runescape.wiki/api.php";
  var DAY = 24 * 3600 * 1000;
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } } };

  var prices = null, pricesAt = 0, facts = {}, pending = {}, queue = [], timer = null, listeners = [];
  var status = { prices: "not loaded", facts: "idle", alch: "not loaded", quests: "not loaded", lastError: "" };

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
  function bulkUrl() {
    var t = []; for (var k in BULK_PAGES) t.push(BULK_PAGES[k]);
    return WIKI_API + "?action=query&format=json&origin=*&prop=revisions&rvprop=content&rvslots=main&titles=" + encodeURIComponent(t.join("|"));
  }
  /* the api answer for the three table pages -> {key: [price, alch, value]}, or null when the price table is not there */
  function parseBulk(j) {
    var pages = j && j.query && j.query.pages || {}, tables = {}, id, k, n = 0, out = {};
    for (id in pages) {
      var pg = pages[id], rev = pg.revisions && pg.revisions[0], text = rev && (rev.slots && rev.slots.main ? (rev.slots.main["*"] !== undefined ? rev.slots.main["*"] : rev.slots.main.content) : rev["*"]);
      if (!text) continue;
      for (k in BULK_PAGES) if (BULK_PAGES[k] === pg.title) { try { tables[k] = JSON.parse(text); } catch (e) { /* not the table we expected */ } }
    }
    if (!tables.price) return null;
    for (k in tables.price) {
      var v = tables.price[k];
      if (k.charAt(0) === "%" || typeof v !== "number") continue;
      var a = tables.alch && typeof tables.alch[k] === "number" ? tables.alch[k] : 0, val = tables.value && typeof tables.value[k] === "number" ? tables.value[k] : 0;
      if (!a && val) a = Math.floor(val * 0.6);      /* high alchemy pays 60% of an item's value */
      out[key(k)] = [v, a, val]; n++;
    }
    status.alch = tables.alch ? "from the wiki's table" : (tables.value ? "worked out from item values" : "not available");
    return n > 100 ? out : null;
  }
  function loadBulk() {
    return fetch(bulkUrl()).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      var p = parseBulk(j);
      if (!p) throw new Error("the wiki's price tables were not where expected");
      return p;
    });
  }
  function loadPrices(force) {
    if (!prices) {
      try { var c = JSON.parse(store.get("bankwise.prices.v1") || "null"); if (c && c.p) { prices = c.p; pricesAt = c.at; status.prices = Object.keys(prices).length + " items (cached)"; } } catch (e) { /* refetch */ }
    }
    if (prices && !force && Date.now() - pricesAt < DAY) return Promise.resolve(true);
    status.prices = prices ? status.prices + ", refreshing" : "loading";
    var bulkWhy = "";
    return loadBulk().catch(function (e) {
      bulkWhy = e.message;
      return fetch(PRICE_URL).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
        var p = parseDump(j);
        if (!p) throw new Error("price file had no items");
        return p;
      }).catch(function (e2) { throw new Error("wiki tables: " + bulkWhy + "; price dump: " + e2.message); });
    }).then(function (p) {
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
    return o && o.price !== null ? { price: o.price, alch: null, value: null } : null;
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
    var urls = [["wiki price + alch tables", bulkUrl()], ["price dump", PRICE_URL], ["price, one item", PRICE_ONE + encodeURIComponent("Magic logs|Santa hat")],
      ["quest list (first 5)", WIKI_API + "?action=query&format=json&origin=*&list=categorymembers&cmtitle=Category:Quests&cmnamespace=0&cmlimit=5"],
      ["gear tier, from the text of Rune platebody", WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=Rune%20platebody"],
      ["wiki categories + opening sentences", WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=categories%7Cextracts&cllimit=max&clshow=!hidden&exintro=1&explaintext=1&exlimit=max&titles=" + encodeURIComponent("Magic logs|Santa hat|Commorb")]];
    return Promise.all(urls.map(function (u) {
      return fetch(u[1]).then(function (r) { return r.text().then(function (t) {
        if (u[0] === "wiki price + alch tables") {
          try {
            var pages = JSON.parse(t).query.pages, rows = [], id;
            for (id in pages) { var pg = pages[id], rev = pg.revisions && pg.revisions[0], txt = rev && (rev.slots && rev.slots.main ? (rev.slots.main["*"] || rev.slots.main.content) : rev["*"]) || ""; rows.push("    " + pg.title + ": " + (pg.missing !== undefined ? "NO SUCH PAGE" : txt.length + " chars, starts " + txt.slice(0, 90).replace(/\s+/g, " "))); }
            return u[0] + ": HTTP " + r.status + ", " + t.length + " chars\n" + rows.join("\n");
          } catch (e) { /* fall through to the raw text */ }
        }
        if (/^gear tier/.test(u[0])) { var raw = t.replace(/\\n/g, "\n"), bx = raw.search(/\{\{\s*Infobox[ _]Bonuses/i); return u[0] + ": HTTP " + r.status + ", " + t.length + " chars\n    read as " + JSON.stringify(parseGear(raw)) + "\n    the box as the wiki has it: " + (bx >= 0 ? raw.slice(bx, bx + 700).replace(/\s+/g, " ") : "NO Infobox Bonuses FOUND"); }
        return u[0] + ": HTTP " + r.status + ", " + t.length + " chars\n    " + t.slice(0, /^wiki categories/.test(u[0]) ? 2200 : 400).replace(/\s+/g, " "); }); })
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
    if (f && Date.now() - f.at < 30 * DAY && f.blurb !== undefined && f.tele !== undefined && f.bv === 2) return f;      /* fields missing = cached by an older version: ask again once */
    if (!pending[k] && name) { pending[k] = 1; queue.push(name); if (!timer) timer = setTimeout(flush, 400); }
    return f || null;
  }
  function flush() {
    timer = null;
    var batch = queue.splice(0, 20);      /* 20 = as many opening paragraphs as the wiki hands out per request */
    if (!batch.length) return;
    status.facts = "asking the wiki about " + batch.length + " item" + (batch.length === 1 ? "" : "s");
    var url = WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=categories%7Cextracts&cllimit=max&clshow=!hidden&exintro=1&explaintext=1&exlimit=max&titles=" + encodeURIComponent(batch.join("|"));
    fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) { return collect(j, url, batch, 0); }).then(function () {
      batch.forEach(function (n) { var k = key(n); delete pending[k]; if (!facts[k]) facts[k] = { at: Date.now(), cats: [], missing: true }; if (facts[k].blurb === undefined) facts[k].blurb = ""; facts[k].bv = 2; if (facts[k].tele === undefined) facts[k].tele = ""; });
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
      var old = facts[key(from)], k = key(from), f = old && old.fresh ? old : (facts[k] = { at: Date.now(), cats: [], fresh: 1, quests: old && old.quests, gear: old && old.gear });
      f.title = pg.title; f.missing = pg.missing !== undefined;
      if (typeof pg.extract === "string" && pg.extract) { f.blurb = tidyBlurb(pg.extract); f.bv = 2; f.tele = teleSentence(pg.extract, f.blurb); }
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
  /* ---------- which quests need this item? ---------- */
  /* the list of every quest (Category:Quests), then for an item: its categories that are named after a quest,
     and failing that the quests its wiki page links to */
  var quests = null, questsLoading = false, questPending = {};
  function nk(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function loadQuests() {
    if (quests || questsLoading) return;
    try { var c = JSON.parse(store.get("bankwise.quests.v1") || "null"); if (c && c.t && c.t.length > 50 && Date.now() - c.at < 30 * DAY) { quests = {}; c.t.forEach(function (t) { quests[nk(t)] = t; }); return; } } catch (e) { /* refetch */ }
    questsLoading = true;
    var titles = [], base = WIKI_API + "?action=query&format=json&origin=*&list=categorymembers&cmtitle=Category:Quests&cmnamespace=0&cmlimit=500";
    (function page(cont, depth) {
      return fetch(base + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "")).then(function (r) { return r.json(); }).then(function (j) {
        ((j.query || {}).categorymembers || []).forEach(function (m) { titles.push(m.title); });
        if (j["continue"] && j["continue"].cmcontinue && depth < 5) return page(j["continue"].cmcontinue, depth + 1);
      });
    })(null, 0).then(function () {
      questsLoading = false;
      if (!titles.length) { status.quests = "the wiki's quest list came back empty"; return; }
      quests = {}; titles.forEach(function (t) { quests[nk(t)] = t; });
      store.set("bankwise.quests.v1", JSON.stringify({ at: Date.now(), t: titles }));
      status.quests = titles.length + " quests"; changed();
    }).catch(function (e) { questsLoading = false; status.quests = "quest list unavailable - " + e.message; });
  }
  /* -> [quest titles] (possibly empty), or null while it is still being worked out */
  function questsFor(name) {
    var k = key(name), f = facts[k];
    if (!f) { factsFor(name); return null; }
    if (f.quests) return f.quests;
    if (!quests) { loadQuests(); return null; }
    var byCat = (f.cats || []).filter(function (c) { return quests[nk(c)]; }).map(function (c) { return quests[nk(c)]; });
    if (byCat.length || f.missing) { f.quests = byCat; saveFacts(); return byCat; }
    if (questPending[k]) return null;
    questPending[k] = 1;
    fetch(WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=links&plnamespace=0&pllimit=max&titles=" + encodeURIComponent(f.title || name)).then(function (r) { return r.json(); }).then(function (j) {
      var pages = j && j.query && j.query.pages || {}, out = [], id;
      for (id in pages) (pages[id].links || []).forEach(function (l) { var q = quests[nk(l.title)]; if (q && out.indexOf(q) < 0) out.push(q); });
      f.quests = out; saveFacts(); delete questPending[k]; changed();
    }).catch(function () { delete questPending[k]; });
    return null;
  }

  /* ---------- gear tier (for "you have outgrown this") ---------- */
  /* read from the item page's own text: the combat-stats box carries tier, class and slot */
  var gearQueue = [], gearPending = {}, gearTimer = null;
  /* what the item page's own text says: the combat-stats box (tier, class, slot, type and whatever stats it lists)
     and, from the item box, the shop value and whether it can be alched */
  var STAT_KEYS = [["damage", "damage"], ["accuracy", "accuracy"], ["style", "style"], ["speed", "speed"], ["attack_range", "range"], ["armour", "armour"], ["life", "life points"], ["prayer", "prayer"],
    ["strength", "strength"], ["ranged", "ranged"], ["magic", "magic"], ["necromancy", "necromancy"], ["requirements", "needs"]];
  function field(text, name) {
    var m = new RegExp("\\|\\s*" + name + "\\d*\\s*=[ \\t]*([^\\n|}]*)", "i").exec(text || "");
    return m ? m[1].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]+>/g, "").trim() : "";
  }
  /* "{{scm|Defence|70}}, {{scm|Attack|70}}" -> "70 Defence, 70 Attack": the skill templates hold the actual requirement */
  function requirements(box) {
    var m = /\|\s*requirements\d*\s*=[ \t]*([^\n]*)/i.exec(box || "");
    if (!m) return "";
    return m[1].replace(/\{\{\s*[A-Za-z]*\s*\|([^|{}]+)\|([^|{}]+)[^{}]*\}\}/g, function (all, a, b) { return /^\d+$/.test(a.trim()) ? a.trim() + " " + b.trim() : /^\d+$/.test(b.trim()) ? b.trim() + " " + a.trim() : a.trim(); })
      .replace(/\{\{[^{}]*\}\}/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/<[^>]+>/g, " ").replace(/[{}|]+/g, " ").replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "");
  }
  function parseGear(text) {
    text = String(text || "");
    var at = text.search(/\{\{\s*Infobox[ _]Bonuses/i), box = at >= 0 ? text.slice(at, at + 2500) : "", out = { v: 3, tier: 0, stats: {} };
    if (box) {
      var end = box.search(/\n\}\}/); if (end > 0) box = box.slice(0, end);
      out.tier = +(field(box, "tier").match(/\d+/) || [0])[0];
      out.cls = field(box, "class").toLowerCase(); out.slot = field(box, "slot").toLowerCase(); out.type = field(box, "type").toLowerCase();
      STAT_KEYS.forEach(function (k) { var v = k[0] === "requirements" ? requirements(box) : field(box, k[0]); if (v && !/^(0|0\.0|no|none|n\/a|-)$/i.test(v)) out.stats[k[1]] = v.slice(0, 40); });
    }
    var val = field(text, "value").replace(/,/g, ""), alchable = field(text, "alchable").toLowerCase();
    if (/^\d+$/.test(val)) out.value = +val;
    out.alchable = alchable ? !/^(no|false|0)$/.test(alchable) : null;
    return out;
  }
  /* -> the object above (tier 0 = the page gives none), or null while it is being fetched */
  function gearFor(name) {
    var k = key(name), f = facts[k];
    if (f && f.gear && f.gear.v === 3) return f.gear;
    if (!f || f.missing) { if (!f) factsFor(name); return null; }
    if (!gearPending[k]) { gearPending[k] = 1; gearQueue.push(name); if (!gearTimer) gearTimer = setTimeout(flushGear, 600); }
    return null;
  }
  function flushGear() {
    gearTimer = null;
    var batch = gearQueue.splice(0, 8);
    if (!batch.length) return;
    fetch(WIKI_API + "?action=query&format=json&origin=*&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=" + encodeURIComponent(batch.join("|"))).then(function (r) { return r.json(); }).then(function (j) {
      var q = j && j.query || {}, back = {}, id;
      (q.normalized || []).concat(q.redirects || []).forEach(function (r) { back[r.to] = back[r.from] || r.from; });
      for (id in (q.pages || {})) {
        var pg = q.pages[id], from = pg.title, guard = 0, rev = pg.revisions && pg.revisions[0];
        while (back[from] && guard++ < 4) from = back[from];
        var text = rev && (rev.slots && rev.slots.main ? (rev.slots.main["*"] !== undefined ? rev.slots.main["*"] : rev.slots.main.content) : rev["*"]);
        if (facts[key(from)]) facts[key(from)].gear = parseGear(text);
      }
      batch.forEach(function (n) { var k = key(n); delete gearPending[k]; if (facts[k] && !(facts[k].gear && facts[k].gear.v === 3)) facts[k].gear = { v: 3, tier: 0, stats: {} }; });
      saveFacts(); changed();
      if (gearQueue.length) gearTimer = setTimeout(flushGear, 1200);
    }).catch(function (e) { batch.forEach(function (n) { delete gearPending[key(n)]; }); status.lastError = "gear tiers: " + e.message; });
  }

  /* the opening of the wiki page */
  function tidyBlurb(t) {
    /* everything the page says before its table of contents; the card shows five lines of it and ends in an ellipsis.
       Kept to a sane length for storage, cut at a sentence end where there is one. */
    t = String(t || "").replace(/\s+/g, " ").replace(/\s*\([^)]{0,40}\bpronounced\b[^)]*\)/i, "").trim();
    if (t.length <= 700) return t;
    var cut = t.slice(0, 700), stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
    return stop > 350 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "...";
  }
  /* the sentence of the opening paragraph that says where a thing teleports to, when the blurb does not already */
  function teleSentence(extract, blurb) {
    var parts = String(extract || "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+(?=\s|$)/g) || [], i;      /* no lookbehind: Alt1's browser may be too old for it */
    for (i = 0; i < parts.length; i++) if (/teleport/i.test(parts[i]) && String(blurb || "").slice(0, 320).indexOf(parts[i].trim().slice(0, 40)) < 0)      /* not if the card's five lines already show it */ return parts[i].trim().slice(0, 220);
    return "";
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
      blurb: f && f.blurb || "", tele: f && f.tele || "",
      wikiTitle: f && f.title || name
    };
  }

  loadFacts();
  return {
    questsFor: questsFor, gearFor: gearFor, _parseGear: parseGear, wikiUrl: function (title) { return "https://runescape.wiki/w/" + encodeURIComponent(String(title || "").replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":"); },
    loadPrices: loadPrices, selfTest: selfTest, resolveName: resolveName, _variants: variants, price: price, pricesLoaded: pricesLoaded, factsFor: factsFor, describe: describe, status: status,
    onChange: function (f) { listeners.push(f); }, key: key,
    clearCache: function () { facts = {}; saveFacts(); prices = null; pricesAt = 0; store.set("bankwise.prices.v1", "null"); },
    _parseDump: parseDump, _parseBulk: parseBulk, _collect: collect, _facts: function () { return facts; }
  };
});
