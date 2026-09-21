/* Bankwise - the app window: reads the bank, learns items as the player hovers them,
   draws value/verdict markers over the game and explains each verdict. */
(function () {
  "use strict";
  var VERSION = "0.8.11";
  var READ_MS = 700, HOVER_MS = 250, OVERLAY_MS = 2500, OVERLAY_GROUP = "bankwise";
  function $(id) { return document.getElementById(id); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  function loadJSON(k, fallback) { try { var v = JSON.parse(store.get(k) || "null"); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; } }

  var DEFAULTS = { template: "five", junkBelow: 500, useQuests: false, useSkills: false, goalLevel: 99, useOverrides: false, overrides: {}, overlay: true, rmUser: "", teach: true };
  /* everything the overlay draws can be switched off, and the value colours and cutoffs are the player's to change */
  var OV_DEFAULTS = {
    showTiers: true, tiers: [{ min: 1000, color: "#4ea56a" }, { min: 10000, color: "#45b5c4" }, { min: 100000, color: "#6f9bff" }, { min: 1000000, color: "#b07cff" }, { min: 10000000, color: "#f0c040" }],
    showStack: true, stackSingles: true, stackMin: 0, stackColor: "#f8d56b",
    tagJ: true, tagD: true, tagQ: true, tagK: true, tagR: false,
    boxUnknown: true, boxUnsure: true, boxGuess: false, cornerTwin: true
  };
  function ovDefaults() { return JSON.parse(JSON.stringify(OV_DEFAULTS)); }
  function hexOk(h) { return /^#[0-9a-f]{6}$/i.test(h || ""); }
  function cleanHex(h) { h = String(h || "").trim(); if (h.charAt(0) !== "#") h = "#" + h; if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return hexOk(h) ? h.toLowerCase() : null; }
  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  var settings = loadJSON("bankwise.settings.v1", {}), k;
  for (k in DEFAULTS) if (settings[k] === undefined) settings[k] = DEFAULTS[k];
  (function () {
    var d = ovDefaults(), o = settings.ov && typeof settings.ov === "object" ? settings.ov : {}, i;
    for (k in d) if (o[k] === undefined || typeof o[k] !== typeof d[k]) o[k] = d[k];
    if (!Array.isArray(o.tiers) || o.tiers.length !== d.tiers.length) o.tiers = d.tiers;
    for (i = 0; i < o.tiers.length; i++) { if (!o.tiers[i] || !hexOk(o.tiers[i].color)) o.tiers[i] = d.tiers[i]; o.tiers[i].min = Math.max(0, +o.tiers[i].min || 0); }
    if (!hexOk(o.stackColor)) o.stackColor = d.stackColor;
    settings.ov = o;
  })();
  function tierOf(price) { return Verdict.tier(price, settings.ov.tiers.map(function (t) { return t.min; })); }
  var profile = loadJSON("bankwise.profile.v1", null);
  var lib = Library.fromJSON(loadJSON("bankwise.library.v1", null)), libVersion = 1, libSaveTimer = null, libSaveFailed = false;

  var NOT_A_NAME = /^((withdraw|deposit)(-\S+)?|view tab \d+)$/i;
  lib.names().forEach(function (n) { if (NOT_A_NAME.test(n) || n.length < 3) lib.forget(n); });   /* v0.2.x could learn the action word as a name */

  var nameColours = loadJSON("bankwise.namecolours.v1", {}), tipColour = null;   /* the colour the game draws each item's name in - it means something, not yet known what */

  var view = null;              /* last successful read: {grid, slots, buf} with identities on the slots */
  var idCache = {}, idCacheVersion = 0;
  var clean = {};               /* position -> the slot as seen while the mouse was elsewhere (what gets taught) */
  var shown = null;             /* what the detail card shows: {slot} from the bank or {name} from the list */
  var hoverSlot = null, tipName = "", tipCount = 0, tipRaw = "", tipArea = null, tipWhy = "", lastTaught = "";
  var seedInfo = "not loaded yet";
  var total = 0, totalUnknown = 0;
  var filter = "all", overlaySig = "", overlayAt = 0, lastError = "";

  function saveSettings() { store.set("bankwise.settings.v1", JSON.stringify(settings)); }
  function saveLibrary() {
    clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(function () { libSaveFailed = !store.set("bankwise.library.v1", JSON.stringify(lib.toJSON())); renderLibStatus(); }, 800);
  }

  /* ---------- identify ---------- */
  /* twin = identical icon shared by several items; guess = "probably X", from the wiki's icons */
  function named(s) { return s.id.state === "known" || s.id.state === "twin" || s.id.state === "guess"; }
  function sure(s) { return s.id.state === "known" || s.id.state === "twin"; }
  var wiki = new WikiLib.IconLibrary(), wikiInfo = "not loaded", wikiRaw = null, guessCache = {}, building = null;
  function setWiki(raw, from) {
    wikiRaw = raw; guessCache = {};
    if (raw && raw.names && raw.names.length) { wiki.load(raw.names, raw.files, raw.patches); wikiInfo = raw.names.length + " wiki icons (" + from + ", built " + new Date(raw.at).toLocaleDateString() + ")"; }
    else { wiki = new WikiLib.IconLibrary(); wikiInfo = "none - build it in Settings"; }
    overlaySig = ""; if (typeof renderWikiStatus === "function") renderWikiStatus();
  }
  /* wiki guesses for the slots the library does not know; a few per read so the app never stalls */
  function guessUnknown(r) {
    if (!wiki.n) return;
    var budget = 8;
    r.slots.forEach(function (s) {
      if (s.covered || sure(s) || s.id.state === "covered") return;
      var g = guessCache[s.hash];
      if (g === undefined) { if (budget-- <= 0) return; g = guessCache[s.hash] = wiki.guess(WikiLib.slotView(r.buf, s, r.off, Reader.NUM_BAND)) || null; }
      if (g) s.id = { state: "guess", name: g.name, d: g.d, alts: g.alts, rival: s.id.name || null, rivalD: s.id.d };
    });
  }
  /* stack sizes: read fresh every time (cheap), kept from the previous read while a tooltip covers the slot */
  function readStacks(r) {
    var prev = {};
    if (view) view.slots.forEach(function (s) { prev[posKey(s)] = s.stack; });
    r.slots.forEach(function (s) {
      if (s.covered) { s.stack = prev[posKey(s)] || null; return; }
      try { s.stack = Stack.read(r.buf, s, r.off); } catch (e) { s.stack = null; }
    });
  }
  function stackValue(s, it) { return it.price !== null && s.stack && s.stack.qty ? it.price * s.stack.qty : null; }
  function hash(pt) { var h = 2166136261, i; for (i = 0; i < pt.length; i++) { h ^= pt[i]; h = (h * 16777619) >>> 0; } return h.toString(36); }
  function posKey(s) { return s.x + "," + s.y; }
  function overlaps(s, a) { return a && s.x < a.x + a.width + 4 && s.x + s.w > a.x - 4 && s.y < a.y + a.height + 4 && s.y + s.h > a.y - 4; }
  function identifyAll(r, mouse) {
    if (idCacheVersion !== libVersion) { idCache = {}; idCacheVersion = libVersion; }
    var prev = {};
    if (view) view.slots.forEach(function (s) { prev[posKey(s)] = s; });
    r.slots.forEach(function (s) {
      var pk = posKey(s), under = mouse && mouse.x >= s.x && mouse.x < s.x + s.w && mouse.y >= s.y && mouse.y < s.y + s.h;
      /* a tooltip drawn over a slot is not the item: keep what was there a moment ago */
      if ((s.covered || overlaps(s, tipArea)) && !under) {
        if (prev[pk] && prev[pk].id.state !== "covered") { s.patch = prev[pk].patch; s.shifts = prev[pk].shifts; s.hash = prev[pk].hash; s.id = prev[pk].id; }
        else s.id = { state: "covered", d: Infinity, rivalD: Infinity };
        s.covered = true; return;
      }
      s.hash = hash(s.patch);
      s.id = idCache[s.hash] || (idCache[s.hash] = lib.identify(s.patch, s.shifts));
      if (!under) clean[pk] = { patch: s.patch, shifts: s.shifts, hash: s.hash, at: Date.now() };
    });
  }
  var GEAR_KINDS = { weapon: 1, armour: 1, ammo: 1, jewellery: 1 };
  /* tier, class and slot from the curated ladders when the item is on one (the wiki's text is not always the
     game's tier: it gave the dragonfire shield 50, the game and the ladder say 70), the wiki's stats on top */
  function gearOf(name, fetch) {
    var c = Gear.lookup(name), w = fetch ? Data.gearFor(name) : null;
    if (!c) return w;
    var g = { v: 3, tier: c.t || (w && w.tier) || 0, cls: c.st[0] === "all" ? (w && w.cls) || "" : c.st[0], slot: (w && w.slot) || c.s, type: w && w.type || "", stats: w && w.stats || {}, value: w && w.value, alchable: w ? w.alchable : null, curated: true };
    return g;
  }
  /* kinds whose names already say what they are; coins, runes and teleports are linked from half the quests in the game */
  var NOT_QUESTY = { currency: 1, teleport: 1, runes: 1, potion: 1, food: 1, clue: 1, keys: 1, holiday: 1, ammo: 1, seeds: 1 };
  function info(name, forCard) {
    var it = Data.describe(name), wikiSaysQuest = !!it.questItem;
    /* the wiki does not file every quest item or quest reward under a category that says so, but its opening text
       usually does ("is used in The Feud quest", "a reward from the quest ..."): for untradeable items that counts too */
    if (it.blurb && /\b(is|are) (an? |the )?([a-z-]+ ){0,2}artefacts?\b|\brestor(ed|ing) (at|on|an?|the)\b[^.]{0,60}\barchaeolog/i.test(it.blurb.slice(0, 300))) it.cats = it.cats.concat(["Archaeology artefacts"]);
    /* "used to bail water out of the boat during the Fishing Trawler minigame": the first sentences name the minigame or D&D */
    if (it.blurb && Kinds.minigameIn(it.blurb.slice(0, 200))) it.cats = it.cats.concat(["Minigame items"]);
    if (it.tradeable === false && it.blurb) {
      var open = it.blurb.slice(0, 500);
      if (/\brewards?\b[^.]{0,60}\bquest\b|\bquest\b[^.]{0,40}\brewards?\b/i.test(open)) it.cats = it.cats.concat(["Quest rewards"]);
      else if (/\b(used|needed|required|obtained|made|found|received|given|worn|created)\b[^.]{0,100}\bquest\b|\bquest item\b/i.test(open)) { it.cats = it.cats.concat(["Quest items"]); it.questItem = true; }
    }
    /* and the surest sign of all: a quest's own page lists it.  Asked for untradeable items only - quests link to
       every rope and rune they mention, and those are not quest items */
    if (it.tradeable === false && it.known && !NOT_QUESTY[Kinds.kindOf(name, [])]) {
      it.quests = Data.questsFor(name);
      if (it.quests && it.quests.length && it.cats.indexOf("Quest rewards") < 0 && it.cats.indexOf("Quest items") < 0) { it.cats = it.cats.concat(["Quest items"]); it.questByLinks = true; }
    }
    it.kind = Kinds.kindOf(name, it.cats, it.tradeable === false);
    it.questSure = wikiSaysQuest;      /* the wiki's own quest-item category, not our reading of links or text */
    it.tab = Kinds.tabFor(it.kind, settings.template, name);
    it.upgradeable = Kinds.upgradeable(name);
    /* the item page's own text (stats, shop value, alchable) is only fetched when it can matter:
       for the card of a piece of gear, for the outgrown-gear rule, and before telling anyone to destroy something */
    if (forCard && (GEAR_KINDS[it.kind] || it.kind === "quest" || it.kind === "keepsake")) it.gear = gearOf(name, true);      /* quest items and rewards are often worn too */
    else if (settings.useSkills && profile && profile.levels && it.tradeable && !it.upgradeable && (it.kind === "weapon" || it.kind === "armour")) it.gear = gearOf(name, !Gear.lookup(name));
    if (!it.gear && !it.alch && Verdict.judge(it, settings, profile, Kinds).id === "destroy") it.gear = Data.gearFor(name);
    it.verdict = Verdict.judge(it, settings, profile, Kinds);
    if (it.verdict.id === "destroy" && it.gear === null) it.verdict = { id: "review", tag: "", reason: it.verdict.reason + " Checking whether it can be high alched first..." };
    if (name === "Coins") { it.price = 1; it.verdict = { id: "keep", tag: "", reason: "Money." }; }
    it.tier = tierOf(it.price);
    return it;
  }

  try { localStorage.removeItem("bankwise.bank.v1"); } catch (e) { /* 0.7.0 kept a running bank total here; the feature is gone */ }

  /* ---------- what is in the bank (names only) ---------- */
  /* The app only ever sees the part of the bank on screen, so "best gear" works from a record of every
     item it has recognised there, with the day it last saw it. */
  var seen = loadJSON("bankwise.seen.v1", {}), seenDirty = false, seenSavedAt = 0;
  function noteSeen(r) {
    var day = Math.floor(Date.now() / 864e5);
    r.slots.forEach(function (s) { if (s.covered || !named(s)) return; if (seen[s.id.name] !== day) { seen[s.id.name] = day; seenDirty = true; } });
    if (seenDirty && Date.now() - seenSavedAt > 5000) { seenDirty = false; seenSavedAt = Date.now(); store.set("bankwise.seen.v1", JSON.stringify(seen)); }
  }

  /* ---------- best gear ---------- */
  var gearStyle = "melee", gearOpen = false;
  function renderGear() {
    if (!gearOpen) return;
    var names = Object.keys(seen), pending = 0, pieces = [], useLevels = settings.useSkills && profile && profile.levels ? profile.levels : null;
    names.forEach(function (n) {
      var p = Gear.describe(n, null);
      if (!p) { var kd = Kinds.kindOf(n, (Data.describe(n).cats) || []); if (!GEAR_KINDS[kd]) return; var w = Data.gearFor(n); if (w === null) { pending++; return; } p = Gear.describe(n, w); }
      if (p) pieces.push(p);
    });
    var best = Gear.best(pieces, gearStyle, useLevels), html = "";
    Gear.SLOTS.forEach(function (sl) {
      var o = best[sl[0]];
      if (!o.best && !o.locked && (sl[0] === "ammo" && gearStyle !== "ranged")) return;
      html += '<div class="gearrow"><span class="gslot">' + sl[1] + "</span><span class='gname'>" +
        (o.best ? '<a href="#" class="ext" data-url="' + esc(Data.wikiUrl(o.best.name)) + '">' + esc(o.best.name) + "</a>" + (o.best.tier ? ' <span class="qty">tier ' + o.best.tier + "</span>" : "") : '<span class="qty">nothing seen in the bank</span>') +
        (o.locked ? '<div class="glocked">better, not wearable yet: ' + esc(o.locked.name) + (o.locked.tier ? " (tier " + o.locked.tier + ")" : "") + " - needs " + esc(o.locked.needs.join(", ")) + "</div>" : "") + "</span></div>";
    });
    html += '<div class="hint">From the ' + pieces.length + " pieces of gear Bankwise has recognised among the " + names.length + " items seen in your bank" + (pending ? " (still looking up " + pending + ")" : "") +
      ". Scroll through your tabs so it has seen everything; what you are wearing is not counted. " + (useLevels ? "Limited to what your levels let you wear." : "Turn on skill levels in Settings to limit this to what you can wear.") +
      ' The two-handed and the main + off-hand rows are alternatives. <a href="#" id="seenreset">forget what was seen</a></div>';
    if (html !== $("gearrows")._html) { $("gearrows").innerHTML = html; $("gearrows")._html = html; }
    Array.prototype.forEach.call($("gearstyles").querySelectorAll("button"), function (b) { b.className = b.getAttribute("data-style") === gearStyle ? "on" : ""; });
  }
  function showGear(open) {
    gearOpen = open;
    $("gearpanel").style.display = open ? "" : "none"; $("list").style.display = open ? "none" : ""; $("bestgear").className = open ? "on" : "";
    Array.prototype.forEach.call($("filters").querySelectorAll("button[data-f]"), function (o) { o.className = !open && o.getAttribute("data-f") === filter ? "on" : ""; });
    renderGear();
  }

  /* ---------- overlay ---------- */
  var COL = null;
  function colours() {
    if (COL) return COL;
    var m = A1lib.mixColor;
    COL = { red: m(208, 74, 58), amber: m(224, 160, 48), tag: m(255, 255, 255), warn: m(255, 120, 80) };
    settings.ov.tiers.forEach(function (t, i) { var c = rgb(t.color); COL["t" + (i + 1)] = m(c[0], c[1], c[2]); });
    var g = rgb(settings.ov.stackColor); COL.stack = m(g[0], g[1], g[2]);
    return COL;
  }
  function overlayOk() { return window.alt1 && alt1.permissionOverlay && settings.overlay; }
  function clearOverlay() {
    if (!window.alt1 || !alt1.permissionOverlay || !overlaySig) return;
    /* the group is frozen between draws, so a clear only shows once the group is refreshed */
    try { alt1.overLaySetGroup(OVERLAY_GROUP); alt1.overLayClearGroup(OVERLAY_GROUP); if (alt1.overLayRefreshGroup) alt1.overLayRefreshGroup(OVERLAY_GROUP); alt1.overLaySetGroup(""); } catch (e) { /* older Alt1 */ }
    overlaySig = "";
  }
  function drawOverlay() {
    if (!overlayOk() || !view) { clearOverlay(); return; }
    var sig = view.slots.map(function (s) { return posKey(s) + ":" + s.id.state[1] + (named(s) ? s.id.name + "x" + (s.stack ? s.stack.text : "?") : ""); }).join("|") + "#" + Data.status.prices + Data.status.facts, now = Date.now();
    if (sig === overlaySig && now - overlayAt < OVERLAY_MS - 1500) return;
    var c = colours();
    try {
      alt1.overLaySetGroup(OVERLAY_GROUP);
      if (alt1.overLayFreezeGroup) alt1.overLayFreezeGroup(OVERLAY_GROUP);
      alt1.overLayClearGroup(OVERLAY_GROUP);
      var ov = settings.ov, TAGS = { J: ov.tagJ, D: ov.tagD, Q: ov.tagQ, K: ov.tagK, "?": ov.tagR };
      view.slots.forEach(function (s) {
        if (s.id.state === "covered") return;
        var inset = Math.round(s.w * 0.07), size = Math.max(9, Math.round(s.w * 0.25));
        if (s.id.state === "unknown") { if (ov.boxUnknown) alt1.overLayRect(c.red, s.x + inset, s.y + inset, s.w - 2 * inset, s.h - 2 * inset, OVERLAY_MS, 2); return; }
        if (s.id.state === "unsure") { if (ov.boxUnsure) alt1.overLayRect(c.amber, s.x + inset, s.y + inset, s.w - 2 * inset, s.h - 2 * inset, OVERLAY_MS, 2); return; }
        var it = info(s.id.name), sv = stackValue(s, it);
        if (s.id.state === "guess" && ov.boxGuess) alt1.overLayRect(c.amber, s.x + inset, s.y + inset, s.w - 2 * inset, s.h - 2 * inset, OVERLAY_MS, 1);   /* thin amber = probably, hover to confirm */
        if (s.id.state === "twin" && ov.cornerTwin) alt1.overLayRect(c.amber, s.x + inset, s.y + s.h - inset - 4, 4, 4, OVERLAY_MS, 2);      /* shares its icon with other items */
        /* the colour says what ONE of the item is worth; a bar along the top, clear of the stack number below it */
        if (ov.showTiers && c[it.tier.id]) alt1.overLayRect(c[it.tier.id], s.x + inset, s.y + 1, s.w - 2 * inset, 2, OVERLAY_MS, 2);
        /* the whole stack's worth, written under the item the way the game writes gold */
        var worth = sv !== null ? sv : (s.stack === null ? null : it.price);
        if (ov.showStack && worth !== null && worth >= ov.stackMin && (ov.stackSingles || (s.stack && s.stack.qty > 1))) {
          var txt = (s.stack && s.stack.approx ? "~" : "") + Verdict.short(worth), ts = Math.max(9, Math.round(s.w * 0.23));
          if (alt1.overLayTextEx) alt1.overLayTextEx(txt, c.stack, ts, Math.round(s.x + s.w / 2), s.y + s.h - Math.round(ts * 0.5), OVERLAY_MS, "", true, true);
          else alt1.overLayText(txt, c.stack, ts, s.x + inset, s.y + s.h - ts, OVERLAY_MS);
        }
        var tag = it.verdict.tag || (it.verdict.id === "review" ? "?" : "");
        if (tag && TAGS[tag]) {
          var col = it.verdict.id === "keep" ? c.tag : c.warn;      /* top right: the stack number owns the top left, the value the bottom */
          if (alt1.overLayTextEx) alt1.overLayTextEx(tag, col, size, s.x + s.w - inset - Math.round(size * 0.45), s.y + inset + Math.round(size * 0.55), OVERLAY_MS, "", true, true);
          else alt1.overLayText(tag, col, size, s.x + s.w - inset - size, s.y + inset, OVERLAY_MS);
        }
      });
      if (alt1.overLayRefreshGroup) alt1.overLayRefreshGroup(OVERLAY_GROUP);
      alt1.overLaySetGroup("");
      overlaySig = sig; overlayAt = now;
    } catch (e) { /* the overlay is a nicety - never let it stop the app */ }
  }

  /* ---------- reading loop ---------- */
  var MESSAGES = {
    "no-alt1": "Open this inside Alt1 to read your bank. Settings work here too.",
    "no-permission": "Give this app screen-capture permission in Alt1 (spanner icon on the app window).",
    "no-rs": "Alt1 has not found the RuneScape window yet.",
    "no-capture": "Alt1 did not hand over a capture.",
    "no-bank": "Open your bank.",
    "no-grid": "Open your bank. (If it is open, press reader debug and send me the capture.)"
  };
  function mousePos() { try { return window.alt1 ? A1lib.getMousePosition() : null; } catch (e) { return null; } }
  function tick() {
    var r;
    try { r = Reader.read(view ? view.grid : null, tipArea ? { y0: tipArea.y, y1: tipArea.y + tipArea.height } : null); } catch (e) { r = { error: "crash", message: String(e && e.message || e) }; }
    if (r.error) {
      lastError = r.error;
      if (view) { view = null; hoverSlot = null; clearOverlay(); render(); }
      setStatus(MESSAGES[r.error] || ("Reader problem: " + (r.message || r.error)), r.error !== "no-bank");
      return;
    }
    lastError = "";
    identifyAll(r, mousePos());
    /* the reader fell back on the old lattice, and what sits in the slots is no longer what was there: the bank has closed */
    if (r.grid.reused && view) {
      var was = {}, gone = 0, had = 0;
      view.slots.forEach(function (s) { if (sure(s)) was[posKey(s)] = 1; });
      r.slots.forEach(function (s) { if (was[posKey(s)] && !s.covered) { had++; if (!sure(s)) gone++; } });
      if (had >= 4 && gone > 0.3 * had) { Reader.reset(); view = null; hoverSlot = null; clearOverlay(); render(); setStatus(MESSAGES["no-bank"], false); return; }
    }
    guessUnknown(r);
    readStacks(r);
    noteSeen(r);
    view = r;
    render(); drawOverlay();
  }
  function setStatus(text, warn) { var el = $("status"); el.textContent = text; el.className = warn ? "warn" : ""; }

  /* ---------- hover to teach ---------- */
  /* the tooltip reader already separates the action from the name (by colour); this only tidies */
  function cleanName(raw) {
    var t = String(raw || "").replace(/\s+/g, " ").replace(/^[^A-Za-z0-9'(]+|[^A-Za-z0-9')+]+$/g, "").trim();
    return NOT_A_NAME.test(t) ? "" : t;
  }
  /* the tooltip near the mouse, in capture coordinates: {area, text, why} or null */
  function readTip(m) {
    var W = alt1.rsWidth || 0, H = alt1.rsHeight || 0, x = Math.max(0, m.x - 460), y = Math.max(0, m.y - 420);
    var w = Math.min((W || m.x + 460) - x, m.x + 460 - x), h = Math.min((H || m.y + 420) - y, m.y + 420 - y);
    var buf = Reader.grab(x, y, w, h);
    if (!buf) return null;
    var tip = TipReader.read(buf, m.x - x, m.y - y);
    if (!tip) return null;
    var a = tip.area.whole || tip.area;
    return { area: { x: a.x + x, y: a.y + y, width: a.width, height: a.height }, text: tip.text, why: tip.why, colours: tip.colours, font: tip.font, colour: tip.colour };
  }
  function hoverTick() {
    if (!view || !window.TipReader || !window.alt1) return;      /* the card follows the mouse whether or not teach is on */
    var m = mousePos(), slot = null;
    if (m) view.slots.forEach(function (s) { if (m.x >= s.x && m.x < s.x + s.w && m.y >= s.y && m.y < s.y + s.h) slot = s; });
    if (!slot) { if (hoverSlot) { hoverSlot = null; tipCount = 0; tipArea = null; } return; }
    if (!hoverSlot || posKey(hoverSlot) !== posKey(slot)) { tipCount = 0; tipName = ""; }
    hoverSlot = slot; shown = { slot: slot };
    var name = "";
    try {
      var tip = readTip(m);
      tipArea = tip ? tip.area : null;
      if (tip) { tipColour = tip.colour || null; tipRaw = tip.text || ""; tipWhy = tip.text ? "read with the " + tip.font + " font, name colour " + (tip.colour || []).join(",") : (tip.why || "") + (tip.colours ? "; brightest colours on the line: " + tip.colours.join("  ") : ""); name = cleanName(tipRaw); }
      else tipWhy = "no tooltip box found near the mouse";
    } catch (e) { tipWhy = "tooltip reader crashed: " + (e && e.message || e); }
    if (name.length >= 3 && name === tipName) tipCount++; else { tipName = name; tipCount = name ? 1 : 0; }
    if (tipCount === 2 && settings.teach) { if (tipColour) { nameColours[name] = tipColour; store.set("bankwise.namecolours.v1", JSON.stringify(nameColours)); } teach(slot, name); }
    renderCard();
  }
  function teach(slot, name, force) {
    var src = clean[posKey(slot)] || slot, was = slot.id.state;
    if (!force && sure(slot) && slot.id.name === name) return;
    /* only a correction typed by the player removes what was there: different items can share one
       identical icon, and the tooltip naming one of them must not make the app forget the others */
    if (force && slot.id.name && slot.id.name !== name && slot.id.state !== "unknown") lib.unlearn(slot.id.name, src.patch);
    /* the wiki is sure this is something else AND it looks nothing like the wiki's picture of the
       name just read: the tooltip and the slot do not belong together (a stale tooltip, a shifted
       grid) - do not poison the library; typing the name yourself still overrides this */
    if (!force && wiki.n && view) {
      var sv = WikiLib.slotView(view.buf, slot, view.off, Reader.NUM_BAND), own = wiki.distanceTo(name, sv), g = sv && wiki.guess(sv);
      if (own !== null && own > 40 && g && g.name !== name && g.alts.indexOf(name) < 0) { tipWhy = "NOT learned: this slot looks like " + g.name + " (" + g.d.toFixed(1) + "), not like " + name + " (" + own.toFixed(1) + ")"; return; }
    }
    var added = lib.add(name, src.patch, "taught", src.shifts);
    if (added || force || was === "twin") { libVersion++; lastTaught = name; saveLibrary(); Data.factsFor(name); overlaySig = ""; }
    /* the font reader confuses l and i ("Diamond boits"): if the wiki has no such item but does
       have one a letter away, take the wiki's spelling */
    if (added && !force) Data.resolveName(name).then(function (fixed) {
      if (!fixed || fixed === name || !lib.byName[name]) return;
      lib.rename(name, fixed);
      if (nameColours[name]) { nameColours[fixed] = nameColours[name]; delete nameColours[name]; store.set("bankwise.namecolours.v1", JSON.stringify(nameColours)); }
      libVersion++; lastTaught = fixed + " (read as " + name + ")"; saveLibrary(); Data.factsFor(fixed); overlaySig = "";
    });
  }

  /* ---------- rendering ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function slotImg(s) { if (!s._img && view && view.buf) { try { s._img = Reader.slotImage(view.buf, s, view.off); } catch (e) { s._img = ""; } } return s._img || ""; }
  function render() {
    if (!view) { $("counts").innerHTML = ""; $("list").innerHTML = '<div class="empty">Nothing to show until the bank is open.</div>'; $("list")._html = ""; renderCard(); return; }
    var known = 0, unsure = 0, unknown = 0, guessed = 0;
    view.slots.forEach(function (s) { if (s.id.state === "guess") guessed++; else if (named(s)) known++; else if (s.id.state === "unsure") unsure++; else if (s.id.state !== "covered") unknown++; });
    /* an item recognised from the wiki's icon is treated as known: hovering it still corrects it, but nobody is asked to */
    setStatus(unknown + unsure ? (settings.teach ? "Sweep your mouse over the boxed items so I can learn them." : "Learning is off. Turn on teach to learn the boxed items.") : "Every item on screen is known.", false);
    $("counts").innerHTML = "<span><b>" + view.slots.length + "</b> on screen</span><span title='" + guessed + " of them recognised from the wiki icons'><b>" + (known + guessed) + "</b> known</span><span><b>" + (unknown + unsure) + "</b> to teach</span><span><b>" + lib.names().length + "</b> in library</span>";
    renderList(); renderCard();
    var cg = confidentGuesses().length;
    $("acceptguesses").style.display = cg ? "" : "none"; $("acceptguesses").textContent = "Accept " + cg + " sure guess" + (cg === 1 ? "" : "es");
    if (total) $("counts").innerHTML += "<span>worth about <b>" + Verdict.short(total) + "</b> on screen</span>";
  }
  function renderList() {
    var rows = [], seen = {};
    view.slots.forEach(function (s) {
      if (s.id.state === "covered") return;
      if (!named(s)) { rows.push({ slot: s, teach: true, price: -1 }); return; }
      var it = info(s.id.name), sv = stackValue(s, it), qty = s.stack ? s.stack.qty : null;
      if (seen[s.id.name]) { var first = seen[s.id.name]; if (qty !== null && first.qty !== null) first.qty += qty; else first.qty = null; first.value = first.qty !== null && it.price !== null ? it.price * first.qty : null; first.price = first.value === null ? first.price : first.value; return; }
      rows.push(seen[s.id.name] = { slot: s, it: it, qty: qty, value: sv, approx: !!(s.stack && s.stack.approx), price: sv !== null ? sv : (it.price === null ? -0.5 : it.price) });
    });
    total = 0; totalUnknown = 0;
    rows.forEach(function (r) { if (r.teach) return; if (r.value !== null) total += r.value; else if (r.it.price !== null) { total += r.it.price; totalUnknown++; } });
    rows = rows.filter(function (r) {
      if (filter === "all") return true;
      if (filter === "teach") return !!r.teach;
      if (filter === "sell") return !!r.it && (r.it.verdict.id === "sell" || r.it.verdict.id === "alch" || r.it.verdict.id === "destroy");
      return !!r.it && r.price > 0;      /* valuable */
    });
    if (filter !== "all") rows.sort(function (a, b) { return b.price - a.price; });      /* "All" stays in bank order */
    var html = rows.map(function (r, i) {
      var img = slotImg(r.slot);
      if (r.teach) return '<div class="item" data-i="' + i + '"><div class="mini" style="background-image:url(' + img + ')"></div><div class="nm"><span class="chip ' + (r.slot.id.state === "unsure" ? "unsure" : "teach") + '">' + (r.slot.id.state === "unsure" ? "unsure" : "new") + "</span> " + (r.slot.id.state === "unsure" ? esc(r.slot.id.name) + "?" : "hover it in the bank") + "</div></div>";
      return '<div class="item" data-i="' + i + '"><div class="mini" style="background-image:url(' + img + ')"></div><div class="nm">' + (r.it.verdict.id !== "keep" ? '<span class="chip ' + r.it.verdict.id + '">' + Verdict.LABEL[r.it.verdict.id] + "</span> " : "") + esc(r.it.name) + (r.qty > 1 ? ' <span class="qty">x' + Verdict.short(r.qty) + "</span>" : "") + '</div><div class="tabn">tab ' + r.it.tab.number + '</div><div class="pr ' + r.it.tier.id + '" title="' + (r.it.price !== null ? Verdict.gp(r.it.price) + " each" : "") + '">' + (r.value !== null ? (r.approx ? "~" : "") + Verdict.short(r.value) : Verdict.short(r.it.price)) + "</div></div>";
    }).join("");
    html = html || '<div class="empty">Nothing in this filter.</div>';
    if (html !== $("list")._html) { $("list").innerHTML = html; $("list")._html = html; }   /* untouched when nothing changed: keeps scroll and hover steady */
    $("list")._rows = rows;
  }
  function renderCard() {
    var s = shown && shown.slot, live = s && view && view.slots.indexOf(s) >= 0;
    if (s && !live && view) { var pk = posKey(s); s = null; view.slots.forEach(function (q) { if (posKey(q) === pk) s = q; }); if (s) shown.slot = s; }
    if (!s) { $("hicon").style.backgroundImage = ""; $("hname").textContent = view ? "Hover an item" : "Open your bank"; $("hprice").innerHTML = "&nbsp;"; $("halch").innerHTML = "&nbsp;"; $("hblurb").innerHTML = "&nbsp;"; $("hstats").innerHTML = "&nbsp;"; $("hquests").innerHTML = "&nbsp;"; $("hwiki").style.display = "none"; $("hverdict").innerHTML = view ? "Hover an item in the bank, or a row below, to see what it is worth, where it belongs and whether to keep it." : "&nbsp;"; $("htab").innerHTML = "&nbsp;"; $("hpins").style.display = settings.useOverrides ? "" : "none"; $("hpins").style.visibility = "hidden"; $("hfix").style.visibility = "hidden"; return; }
    $("hicon").style.backgroundImage = "url(" + slotImg(s) + ")";
    $("hfix").style.visibility = ""; $("hpins").style.display = settings.useOverrides ? "" : "none";
    if (!named(s)) {
      $("hname").style.color = "";
      $("hname").textContent = s.id.state === "unsure" ? s.id.name + "?" : "Unknown item";
      $("hprice").innerHTML = hoverSlot === s && settings.teach ? (tipName ? "reading: <b>" + esc(tipName) + "</b>" : "keep the mouse still until the game shows its name") : "&nbsp;";
      $("halch").innerHTML = "&nbsp;"; $("hblurb").innerHTML = "&nbsp;"; $("hstats").innerHTML = "&nbsp;"; $("hquests").innerHTML = "&nbsp;"; $("hwiki").style.display = "none";
      $("hverdict").innerHTML = '<span class="chip ' + (s.id.state === "unsure" ? "unsure" : "teach") + '">' + (s.id.state === "unsure" ? "unsure" : "new") + "</span>" + (s.id.state === "unsure" ? "Looks like " + esc(s.id.name) + (s.id.rival ? " or " + esc(s.id.rival) : "") + ". Hover it in the bank to confirm." : (settings.teach ? "Hover it in the bank and I will remember it from then on." : "Teach is off. Tick teach at the top, then hover it, and I will remember it."));
      $("htab").innerHTML = "&nbsp;"; $("hpins").style.visibility = "hidden";
      return;
    }
    var it = info(s.id.name, true);
    $("hname").textContent = it.name;
    $("hname").style.color = nameColours[it.name] ? "rgb(" + nameColours[it.name].join(",") + ")" : "";
    var sv = stackValue(s, it), st = s.stack;
    var many = st && st.qty > 1;
    $("hprice").innerHTML = it.price !== null
      ? "<b>" + Verdict.gp(it.price) + "</b> each" + (many && sv !== null ? " &middot; " + (st.approx ? "about " : "") + Verdict.short(st.qty) + " of them = <b class='gold'>" + (st.approx ? "~" : "") + Verdict.short(sv) + "</b>" : "") + (st === null ? " &middot; stack size unread" : "")
      : (it.tradeable === false ? "not tradeable" : "price not loaded") + (many ? " &middot; " + Verdict.short(st.qty) + " of them" : "");
    $("halch").innerHTML = it.alch ? "High alch <b>" + Verdict.gp(it.alch) + "</b>" + (many ? " &middot; stack <b>" + Verdict.short(it.alch * st.qty) + "</b>" : "") + (it.price !== null && it.alch > it.price ? " <span class='twin'>more than it sells for</span>" : "")
      : (it.tradeable === false ? "High alch: not known for untradeable items" : (it.alch === 0 ? "High alch: nothing" : "High alch: not loaded"));
    $("hblurb").textContent = it.blurb || "\u00a0"; $("hblurb").title = it.blurb || "";
    /* what it is in game terms: where a teleport goes, what style a weapon or piece of armour is, its stats */
    var facts = "";
    if (it.kind === "teleport") { var to = Kinds.teleportsTo(it.name); 
      /* the wiki's own sentence only when it is a whole sentence and the five lines above do not already say where it goes */
      facts = to ? "Teleports to: " + to : (it.tele && /^[A-Z]/.test(it.tele) && /[.!?]$/.test(it.tele) && !/teleport/i.test(String(it.blurb || "").slice(0, 320)) ? it.tele : ""); }
    else if (GEAR_KINDS[it.kind] || (it.gear && it.gear.slot)) {
      var g = it.gear;
      if (g === null || g === undefined) facts = "Looking up its stats...";
      else {
        /* the wiki's class "none" / "all" means it belongs to no combat style: say that, not "None head" */
        var styled = g.cls && !/^(none|all|hybrid|n\/a)$/i.test(g.cls), bits = [], what = [styled ? g.cls : "", g.type && g.type !== g.cls && !/^(none|n\/a)$/i.test(g.type) ? g.type : "", g.slot ? g.slot + (styled ? "" : " slot") : ""].filter(Boolean).join(" ");
        if (what) bits.push(what.charAt(0).toUpperCase() + what.slice(1));
        if (!styled && g.slot) bits.push(g.tier || Object.keys(g.stats || {}).length ? "no combat style" : "no combat stats - worn for looks or for what it unlocks");
        if (g.tier) bits.push("tier " + g.tier);
        for (var sk in (g.stats || {})) bits.push(sk + " " + g.stats[sk]);
        facts = bits.join(" \u00b7 ");
      }
    }
    $("hstats").textContent = facts || "\u00a0"; $("hstats").title = facts;
    $("hwiki").style.display = ""; $("hwiki").setAttribute("data-url", Data.wikiUrl(it.wikiTitle));
    var qhtml = "&nbsp;";
    if (it.questItem || it.kind === "quest" || it.kind === "keepsake") {
      var qs = it.quests !== undefined ? it.quests : Data.questsFor(it.name);
      if (qs === null) qhtml = "Looking up its quests...";
      else if (!qs.length) qhtml = "The wiki does not say which quest it belongs to.";
      else qhtml = (it.kind === "keepsake" ? "From: " : "Needed for: ") + qs.slice(0, 6).map(function (q) {
        var st = profile && profile.quests && profile.quests[Verdict.norm(q)], done = st && st.status === "COMPLETED";
        return '<a href="#" class="ext' + (done ? " done" : "") + '" data-url="' + esc(Data.wikiUrl(q)) + '" title="' + (done ? "you have finished this quest" : "open the quest's wiki page") + '">' + esc(q) + "</a>";
      }).join(", ") + (qs.length > 6 ? " and " + (qs.length - 6) + " more" : "");
    }
    if (qhtml !== $("hquests")._html) { $("hquests").innerHTML = qhtml; $("hquests")._html = qhtml; }
    $("hverdict").innerHTML = '<span class="chip ' + it.verdict.id + '">' + Verdict.LABEL[it.verdict.id] + "</span>" + (it.upgradeable ? '<span class="chip review">upgradeable</span>' : "") + esc(it.verdict.reason) +
      (s.id.state === "guess" ? " <span class='qty'>Recognised from the wiki's icon" + (s.id.alts && s.id.alts.length ? " (could also be " + esc(s.id.alts.join(", ")) + ")" : "") + "; hovering it in the bank settles it.</span>" : "") +
      (s.id.state === "twin" ? " <span class='twin'>Same icon as " + esc(s.id.twins.filter(function (n) { return n !== it.name; }).join(", ")) + " - showing the one you last hovered.</span>" : "");
    $("htab").innerHTML = "Belongs in <b>tab " + it.tab.number + " &middot; " + esc(it.tab.name) + "</b> <span title='" + esc(it.cats.slice(0, 12).join(", ")) + "'>(" + esc(Kinds.KIND_LABEL[it.kind]) + ")</span>";
    $("hpins").style.visibility = "";
    var pin = settings.overrides[Verdict.norm(it.name)] || "";
    Array.prototype.forEach.call($("hpins").querySelectorAll("button"), function (b) { b.className = b.getAttribute("data-pin") === pin && pin ? "on" : ""; });
  }

  /* ---------- settings ---------- */
  function renderTemplate() {
    var t = Kinds.template(settings.template);
    $("templateblurb").textContent = t.blurb;
    $("templatetabs").innerHTML = t.tabs.map(function (tab) { return "<li><b>" + esc(tab[0]) + "</b> &mdash; " + (tab[2] ? esc(tab[2]) : tab[1].map(function (kd) { return esc(Kinds.KIND_LABEL[kd]); }).join(", ")) + "</li>"; }).join("");
  }
  function renderLibStatus() {
    var bytes = (store.get("bankwise.library.v1") || "").length;
    $("libstatus").textContent = lib.names().length + " items learned (" + Math.round(bytes / 1024) + " KB)" + (libSaveFailed ? " - could not save: storage is full, export and trim" : "");
    $("libstatus").className = "hint" + (libSaveFailed ? " bad" : "");
  }
  function renderProfile(msg, bad) {
    var el = $("rmstatus"), parts = [];
    if (profile && profile.levels) parts.push("skill levels");
    if (profile && profile.quests) parts.push(Object.keys(profile.quests).length + " quests");
    el.textContent = msg || (parts.length ? "Loaded " + parts.join(" and ") + " for " + (profile.name || settings.rmUser) + " on " + new Date(profile.at).toLocaleDateString() + "." : "Only needed for the quest-log and skill-level options. The quest log needs a public RuneMetrics profile; skill levels work either way.");
    el.className = "hint" + (bad ? " bad" : parts.length && !msg ? " ok" : "");
    $("rmbox").className = settings.useQuests || settings.useSkills ? "" : "off";
    $("rmurls").innerHTML = RuneMetrics.urls($("rmuser").value || "YourName").map(esc).join("<br>");
  }
  function applySettingsToUI() {
    $("template").innerHTML = Kinds.TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + "</option>"; }).join("");
    $("template").value = settings.template; $("junkbelow").value = settings.junkBelow; $("goallevel").value = settings.goalLevel;
    $("usequests").checked = settings.useQuests; $("useskills").checked = settings.useSkills; $("useoverrides").checked = settings.useOverrides;
    $("overlay").checked = settings.overlay; $("teach").checked = settings.teach; $("rmuser").value = settings.rmUser;
    renderTemplate(); renderLibStatus(); renderProfile(); renderWikiStatus(); renderOverlaySettings(); applyOverlayLook();
  }
  /* ----- overlay settings ----- */
  function applyOverlayLook() {
    var ov = settings.ov, root = document.documentElement.style;
    ov.tiers.forEach(function (t, i) { root.setProperty("--t" + (i + 1), t.color); });
    root.setProperty("--stackgold", ov.stackColor);
    COL = null;
    var on = function (flag, html) { return '<span' + (flag ? "" : ' class="off"') + ">" + html + "</span>"; };
    $("legend").innerHTML = on(ov.boxUnknown, '<i class="sw red"></i>hover to teach') + on(ov.boxUnsure || ov.boxGuess || ov.cornerTwin, '<i class="sw amber"></i>unsure / shares an icon') +
      ov.tiers.map(function (t, i) { return on(ov.showTiers, '<i class="sw t' + (i + 1) + '"></i>' + Verdict.short(t.min) + (i === ov.tiers.length - 1 ? "+" : "")); }).join("") + on(ov.showTiers, "for one") +
      on(ov.showStack, '<b class="gold">12.3K</b> stack value') +
      on(ov.tagJ, "<b>J</b> junk") + on(ov.tagD, "<b>D</b> Diango") + on(ov.tagQ, "<b>Q</b> quest done") + on(ov.tagK, "<b>K</b> quest keep") + (ov.tagR ? on(true, "<b>?</b> check first") : "");
  }
  function renderOverlaySettings() {
    var ov = settings.ov;
    $("ovtiers").checked = ov.showTiers; $("ovstack").checked = ov.showStack; $("ovsingles").checked = ov.stackSingles;
    $("ovstackmin").value = ov.stackMin; $("ovstackcolor").value = ov.stackColor; $("ovstackcolor").className = "hex"; $("ovstackswatch").style.background = ov.stackColor;
    $("tierrows").innerHTML = ov.tiers.map(function (t, i) { return '<div class="tierrow">worth at least <input type="number" min="0" step="1000" data-tier="' + i + '" value="' + t.min + '"> gp <input class="hex" type="text" spellcheck="false" maxlength="7" data-tiercolor="' + i + '" value="' + t.color + '"> <i class="sw" style="background:' + t.color + '"></i></div>'; }).join("");
    Array.prototype.forEach.call($("settings").querySelectorAll("input[data-ov]"), function (el) { el.checked = !!ov[el.getAttribute("data-ov")]; });
  }
  function overlayChanged() { applyOverlayLook(); changed(); }
  $("ovtiers").addEventListener("change", function () { settings.ov.showTiers = this.checked; overlayChanged(); });
  $("ovstack").addEventListener("change", function () { settings.ov.showStack = this.checked; overlayChanged(); });
  $("ovsingles").addEventListener("change", function () { settings.ov.stackSingles = this.checked; overlayChanged(); });
  $("ovstackmin").addEventListener("change", function () { settings.ov.stackMin = Math.max(0, Math.round(+this.value || 0)); this.value = settings.ov.stackMin; overlayChanged(); });
  $("ovstackcolor").addEventListener("change", function () { var h = cleanHex(this.value); this.className = "hex" + (h ? "" : " bad"); if (!h) return; settings.ov.stackColor = h; this.value = h; $("ovstackswatch").style.background = h; overlayChanged(); });
  $("tierrows").addEventListener("change", function (e) {
    var el = e.target, i = el.getAttribute("data-tier"), c = el.getAttribute("data-tiercolor");
    if (i !== null) { settings.ov.tiers[+i].min = Math.max(0, Math.round(+el.value || 0)); el.value = settings.ov.tiers[+i].min; overlayChanged(); }
    else if (c !== null) { var h = cleanHex(el.value); el.className = "hex" + (h ? "" : " bad"); if (!h) return; settings.ov.tiers[+c].color = h; el.value = h; el.nextElementSibling.style.background = h; overlayChanged(); }
  });
  Array.prototype.forEach.call($("settings").querySelectorAll("input[data-ov]"), function (el) { el.addEventListener("change", function () { settings.ov[el.getAttribute("data-ov")] = el.checked; overlayChanged(); }); });
  $("ovreset").addEventListener("click", function () { settings.ov = ovDefaults(); renderOverlaySettings(); overlayChanged(); });

  function changed() { saveSettings(); overlaySig = ""; if (view) { render(); drawOverlay(); } renderProfile(); }

  function renderWikiStatus() {
    if (!$("wikistatus")) return;
    $("wikistatus").textContent = building ? building : wikiInfo;
    $("wikibuild").textContent = building ? "Stop" : (wiki.n ? "Rebuild from the wiki" : "Build from the wiki");
    $("wikidownload").style.display = $("wikidownloadbin").style.display = wikiRaw && wikiRaw.names && wikiRaw.names.length ? "" : "none";
    $("wikiclear").style.display = wiki.n ? "" : "none";
  }
  var cancelBuild = false;
  $("wikibuild").addEventListener("click", function () {
    if (building) { cancelBuild = true; return; }
    cancelBuild = false; building = "asking the wiki for the item list..."; renderWikiStatus();
    WikiBuild.build({ category: $("wikicat").value.trim() || "Items", isCancelled: function () { return cancelBuild; }, onProgress: function (st) {
      building = st.kept + " icons ready - fetched " + st.done + " of " + st.files + (st.listed ? "" : "+ (still listing: " + st.pages + " item pages so far)") + ". Stop keeps what is ready.";
      renderWikiStatus();
    }, onCheckpoint: function (part) { WikiBuild.save(part).catch(function () { /* best effort */ }); } }).then(function (raw) {
      building = null;
      if (!raw.names.length) { wikiInfo = "nothing usable came back"; renderWikiStatus(); return; }
      setWiki(raw, (raw.complete ? "built" : "partial build") + " on this computer" + (raw.note ? "; " + raw.note : ""));
      return WikiBuild.save(raw).catch(function (e) { wikiInfo += " - could not be saved for next time: " + (e && e.message || e); renderWikiStatus(); });
    }).catch(function (e) { building = null; wikiInfo = "build failed: " + (e && e.message || e); renderWikiStatus(); });
  });
  $("wikidownload").addEventListener("click", function () { if (wikiRaw) WikiBuild.download(wikiRaw, "json"); });
  $("wikidownloadbin").addEventListener("click", function () { if (wikiRaw) WikiBuild.download(wikiRaw, "png"); });
  $("wikiclear").addEventListener("click", function () { WikiBuild.clearLocal().then(function () { setWiki(null, ""); }); });

  $("opensettings").addEventListener("click", function () { var open = $("settings").style.display === "none"; $("settings").style.display = open ? "" : "none"; $("main").style.display = open ? "none" : ""; $("opensettings").className = open ? "on" : ""; renderLibStatus(); });
  $("closesettings").addEventListener("click", function () { $("opensettings").click(); });
  $("template").addEventListener("change", function () { settings.template = this.value; renderTemplate(); changed(); });
  $("junkbelow").addEventListener("change", function () { settings.junkBelow = Math.max(0, +this.value || 0); changed(); });
  $("goallevel").addEventListener("change", function () { settings.goalLevel = Math.min(120, Math.max(2, +this.value || 99)); this.value = settings.goalLevel; changed(); });
  $("usequests").addEventListener("change", function () { settings.useQuests = this.checked; changed(); });
  $("useskills").addEventListener("change", function () { settings.useSkills = this.checked; changed(); });
  $("useoverrides").addEventListener("change", function () { settings.useOverrides = this.checked; changed(); });
  $("teach").addEventListener("change", function () { settings.teach = this.checked; saveSettings(); hoverSlot = null; tipArea = null; tipCount = 0; if (view) render(); });
  $("overlay").addEventListener("change", function () { settings.overlay = this.checked; saveSettings(); if (!this.checked) { overlaySig = overlaySig || "x"; clearOverlay(); } else { overlaySig = ""; drawOverlay(); } });
  $("rmuser").addEventListener("input", function () { settings.rmUser = this.value.trim(); saveSettings(); renderProfile(); });
  $("rmfetch").addEventListener("click", function () {
    renderProfile("Asking RuneMetrics...");
    RuneMetrics.lookup(settings.rmUser).then(function (p) {
      profile = p; store.set("bankwise.profile.v1", JSON.stringify(p));
      renderProfile(p.notes.length ? "Partly loaded - " + p.notes.join("; ") + "." : "", p.notes.length > 0); changed();
    }).catch(function (e) { renderProfile("Lookup failed: " + e.message + ". You can paste the data below instead.", true); $("rmpaste").open = true; });
  });
  $("rmadd").addEventListener("click", function () {
    try { profile = RuneMetrics.fromPaste($("rmtext").value, profile || undefined); if (!profile.name) profile.name = settings.rmUser; store.set("bankwise.profile.v1", JSON.stringify(profile)); $("rmtext").value = ""; renderProfile(); changed(); }
    catch (e) { renderProfile("That did not look like RuneMetrics data: " + e.message, true); }
  });
  $("libexport").addEventListener("click", function () {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify((function () { var o = lib.toJSON(); o.colours = nameColours; return o; })())], { type: "application/json" })); a.download = "bankwise-library.json"; document.body.appendChild(a); a.click(); a.remove();
  });
  $("libimport").addEventListener("click", function () { $("libfile").click(); });
  $("libfile").addEventListener("change", function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { try { var other = Library.fromJSON(JSON.parse(rd.result)), n = 0; other.samples.forEach(function (s) { if (lib.add(s.name, s.patch, "imported")) n++; }); libVersion++; saveLibrary(); $("libstatus").textContent = "Imported " + n + " new samples."; } catch (e) { $("libstatus").textContent = "Could not read that file: " + e.message; } };
    rd.readAsText(f); this.value = "";
  });
  $("libclear").addEventListener("click", function () {
    if (this.getAttribute("data-sure") !== "1") { this.setAttribute("data-sure", "1"); this.textContent = "Really forget all " + lib.names().length + " items?"; var b = this; setTimeout(function () { b.setAttribute("data-sure", "0"); b.textContent = "Forget everything"; }, 4000); return; }
    lib = new Library(); libVersion++; saveLibrary(); this.setAttribute("data-sure", "0"); this.textContent = "Forget everything"; renderLibStatus();
  });
  /* confident = one clear candidate (no "or X") and a close match; the rest still want a hover */
  function confidentGuesses() { return view ? view.slots.filter(function (s) { return s.id.state === "guess" && !(s.id.alts && s.id.alts.length) && s.id.d <= 9 && !s.covered; }) : []; }
  $("acceptguesses").addEventListener("click", function () {
    var n = 0;
    confidentGuesses().forEach(function (s) { var src = clean[posKey(s)] || s; if (lib.add(s.id.name, src.patch, "wiki-accepted", src.shifts)) { n++; Data.factsFor(s.id.name); } });
    if (n) { libVersion++; saveLibrary(); overlaySig = ""; tick(); }
  });
  $("bestgear").addEventListener("click", function () { showGear(!gearOpen); });
  Array.prototype.forEach.call($("gearstyles").querySelectorAll("button"), function (b) { b.addEventListener("click", function () { gearStyle = b.getAttribute("data-style"); renderGear(); }); });
  $("gearpanel").addEventListener("click", function (e) {
    var el = e.target;
    if (el.id === "seenreset") { e.preventDefault(); seen = {}; store.set("bankwise.seen.v1", "{}"); if (view) noteSeen(view); $("gearrows")._html = ""; renderGear(); return; }
    while (el && el !== this && !(el.getAttribute && el.getAttribute("data-url"))) el = el.parentNode;
    if (!el || el === this) return;
    e.preventDefault();
    try { if (window.alt1 && alt1.openBrowser) alt1.openBrowser(el.getAttribute("data-url")); else window.open(el.getAttribute("data-url"), "_blank"); } catch (err) { /* nothing to do */ }
  });
  Array.prototype.forEach.call($("filters").querySelectorAll("button[data-f]"), function (b) {
    b.addEventListener("click", function () { if (gearOpen) showGear(false); filter = b.getAttribute("data-f"); Array.prototype.forEach.call($("filters").querySelectorAll("button[data-f]"), function (o) { o.className = o === b ? "on" : ""; }); if (view) renderList(); });
  });
  $("list").addEventListener("mouseover", function (e) {
    var el = e.target; while (el && el !== this && !el.getAttribute("data-i")) el = el.parentNode;
    if (!el || el === this) return;
    var row = (this._rows || [])[+el.getAttribute("data-i")]; if (row) { shown = { slot: row.slot }; renderCard(); }
  });
  Array.prototype.forEach.call($("hpins").querySelectorAll("button"), function (b) {
    b.addEventListener("click", function () {
      var s = shown && shown.slot; if (!s || !named(s)) return;
      var key = Verdict.norm(s.id.name), v = b.getAttribute("data-pin");
      if (v) settings.overrides[key] = v; else delete settings.overrides[key];
      changed();
    });
  });
  /* wiki links open in the player's own browser, not inside the app window */
  $("hover").addEventListener("click", function (e) {
    var el = e.target; while (el && el !== this && !(el.getAttribute && el.getAttribute("data-url"))) el = el.parentNode;
    if (!el || el === this) return;
    e.preventDefault();
    var url = el.getAttribute("data-url");
    try { if (window.alt1 && alt1.openBrowser) alt1.openBrowser(url); else window.open(url, "_blank"); } catch (err) { window.open(url, "_blank"); }
  });
  $("rename").addEventListener("click", function (e) { e.preventDefault(); var s = shown && shown.slot; $("renamebox").style.display = ""; $("renameinput").value = s && s.id.name && s.id.state !== "unknown" ? s.id.name : ""; $("renameinput").focus(); });
  $("renameok").addEventListener("click", function () {
    var s = shown && shown.slot, name = $("renameinput").value.replace(/\s+/g, " ").trim();
    if (!s || name.length < 2) return;
    teach(s, name, true); $("renamebox").style.display = "none"; tick();
  });
  $("renameinput").addEventListener("keydown", function (e) { if (e.key === "Enter") $("renameok").click(); });

  /* ---------- debug ---------- */
  $("dbg").addEventListener("click", function (e) {
    e.preventDefault();
    var out = $("dbgout");
    if (out.style.display !== "none") { out.style.display = "none"; return; }
    var lines = ["Bankwise " + VERSION];
    lines.push("alt1: " + !!window.alt1 + (window.alt1 ? "  pixel: " + !!alt1.permissionPixel + "  overlay: " + !!alt1.permissionOverlay + "  rsLinked: " + !!alt1.rsLinked : ""));
    lines.push("tooltip reader: " + (window.TipReader && window.OCR && window.Alt1Fonts ? "loaded" : "MISSING") + "   last read: " + JSON.stringify(tipRaw) + " (" + tipWhy + ")   last taught: " + JSON.stringify(lastTaught));
    lines.push("prices: " + Data.status.prices); lines.push("wiki facts: " + Data.status.facts); if (Data.status.lastError) lines.push("last data error: " + Data.status.lastError);
    lines.push("starter library: " + seedInfo);
    lines.push("wiki icons: " + wikiInfo);
    lines.push("library: " + lib.names().length + " items, " + lib.samples.length + " samples" + (libSaveFailed ? "  SAVE FAILED" : ""));
    var r = null;
    try { r = Reader.read(); } catch (err) { lines.push("reader crashed: " + err.message); }
    if (r) {
      if (r.captureSize) lines.push("capture " + r.captureSize + "   read area " + r.buf.width + "x" + r.buf.height + " at " + r.off.x + "," + r.off.y);
      if (r.error) lines.push("reader: " + r.error + (r.areas !== undefined ? " (" + r.areas + " background-coloured areas)" : ""));
      if (r.grid) {
        lines.push("grid: pitch " + r.grid.pitch.toFixed(2) + "  " + r.grid.cols.length + " cols from x=" + r.grid.cols[0].toFixed(1) + "  item area " + r.grid.x + "," + r.grid.y + " " + r.grid.w + "x" + r.grid.h + "  col residual " + r.grid.residual.toFixed(2));
        lines.push("rows: " + r.grid.rows.map(function (q) { return q.y.toFixed(1) + "/s" + q.section + (q.clipped ? "c" : ""); }).join(" "));
        lines.push("slots with items: " + r.slots.length);
      }
      if (view && shown && shown.slot && shown.slot.id) lines.push("shown slot: " + JSON.stringify({ x: shown.slot.x, y: shown.slot.y, state: shown.slot.id.state, name: shown.slot.id.name, d: +(+shown.slot.id.d).toFixed(1), rival: shown.slot.id.rival, rivalD: +(+shown.slot.id.rivalD).toFixed(1) }));
    }
    out.textContent = lines.join("\n") + "\n";
    var full = null;
    try { full = window.alt1 ? Reader.fullCapture() : null; } catch (err3) { lines.push("full capture failed: " + err3.message); out.textContent = lines.join("\n") + "\n"; }
    if (full) {
      try {
        var cv = document.createElement("canvas"); cv.width = full.width; cv.height = full.height;
        var id = cv.getContext("2d").createImageData(full.width, full.height); id.data.set(full.data); cv.getContext("2d").putImageData(id, 0, 0);
        var a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "bankwise-capture.png"; a.textContent = "Download this capture (PNG)";
        out.appendChild(a);
      } catch (err2) { out.appendChild(document.createTextNode("(capture export failed: " + err2.message + ")")); }
    }
    var tools = document.createElement("div");
    tools.innerHTML = '\n<a href="#" id="dbgdelay">Capture in 4 seconds (go and hover a bank item, keep still)</a>\n<a href="#" id="dbgdata">Test the wiki data sources</a>\n<a href="#" id="dbgicons">Test wiki icons against my learned items</a>\n';
    out.appendChild(tools);
    $("dbgdelay").addEventListener("click", function (ev) { ev.preventDefault(); delayedCapture(out); });
    $("dbgdata").addEventListener("click", function (ev) {
      ev.preventDefault(); var pre = document.createElement("div"); pre.textContent = "testing..."; out.appendChild(pre);
      Data.selfTest().then(function (res) { pre.textContent = res.join("\n"); });
    });
    $("dbgicons").addEventListener("click", function (ev) { ev.preventDefault(); wikiIconTest(out); });
    out.style.display = "";
  });
  /* Could the wiki's item icons pre-fill the library, or at least GUESS items?  For every learned
     item (up to 80): fetch its wiki icon, lay it on the bank background at the offsets around the
     middle of a 44px slot, and then ask the real question - given what the game draws for item A,
     is A's wiki icon the closest of all the icons fetched?  Reported for two measures: the strict
     worst-block one the app matches with, and a plain average difference. */
  function wikiIconTest(out) {
    var pre = document.createElement("div"); pre.textContent = "wiki icon test: fetching icons..."; out.appendChild(pre);
    var names = lib.names().slice(0, 80), icons = [], failed = [], left = names.length, P = 44, grid = { pitch: P, cols: [P / 2], rows: [{ y: P / 2 }] };
    if (!left) { pre.textContent = "teach a few items first"; return; }
    function mean(a, b) { var t = 0, i; for (i = 0; i < a.length; i++) { var d = a[i] - b[i]; t += d < 0 ? -d : d; } return t / (a.length / 3); }
    function finish() {
      if (--left > 0) return;
      pre.textContent = "wiki icon test: comparing " + icons.length + " icons...";
      setTimeout(function () {
        var rows = [], top1 = [0, 0], top3 = [0, 0];
        icons.forEach(function (me) {
          var sample = lib.byName[me.name][0].patch, scores = icons.map(function (ic) {
            var w = 1e9, m = 1e9; ic.patches.forEach(function (pt) { var a = Library.dist(pt, sample), b = mean(pt, sample); if (a < w) w = a; if (b < m) m = b; });
            return { name: ic.name, w: w, m: m };
          });
          var rank = [0, 1].map(function (k) { var key = k ? "m" : "w", mine = scores.filter(function (q) { return q.name === me.name; })[0][key]; return 1 + scores.filter(function (q) { return q[key] < mine; }).length; });
          [0, 1].forEach(function (k) { if (rank[k] === 1) top1[k]++; if (rank[k] <= 3) top3[k]++; });
          var mineS = scores.filter(function (q) { return q.name === me.name; })[0];
          rows.push(me.name + " (" + me.w + "x" + me.h + "): strict " + mineS.w.toFixed(0) + " rank " + rank[0] + ", average " + mineS.m.toFixed(1) + " rank " + rank[1]);
        });
        pre.textContent = "wiki icon test, " + icons.length + " icons compared, " + failed.length + " not found\n" +
          "right icon is the closest: strict " + top1[0] + "/" + icons.length + ", average " + top1[1] + "/" + icons.length + "   in the top 3: strict " + top3[0] + ", average " + top3[1] + "\n" +
          rows.join("\n") + (failed.length ? "\nnot found: " + failed.join(", ") : "");
      }, 50);
    }
    names.forEach(function (name) {
      var img = new Image(); img.crossOrigin = "anonymous";
      img.onerror = function () { failed.push(name); finish(); };
      img.onload = function () {
        try {
          var w = img.width, h = img.height, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          var cx = cv.getContext("2d"); cx.drawImage(img, 0, 0); var px = cx.getImageData(0, 0, w, h).data, patches = [], dx, dy, x, y;
          var cx0 = Math.round((P - w) / 2), cy0 = Math.round(20.5 - h / 2);
          for (dy = Math.max(0, cy0 - 5); dy <= Math.min(P - h, cy0 + 5); dy++) for (dx = Math.max(0, cx0 - 4); dx <= Math.min(P - w, cx0 + 4); dx++) {
            var buf = { width: P, height: P, data: new Uint8ClampedArray(P * P * 4) };
            for (x = 0; x < P * P; x++) { buf.data[x * 4] = Reader.BG[0]; buf.data[x * 4 + 1] = Reader.BG[1]; buf.data[x * 4 + 2] = Reader.BG[2]; buf.data[x * 4 + 3] = 255; }
            for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var s4 = (y * w + x) * 4, a = px[s4 + 3] / 255, d4 = ((y + dy) * P + x + dx) * 4; buf.data[d4] = px[s4] * a + Reader.BG[0] * (1 - a); buf.data[d4 + 1] = px[s4 + 1] * a + Reader.BG[1] * (1 - a); buf.data[d4 + 2] = px[s4 + 2] * a + Reader.BG[2] * (1 - a); }
            patches.push(Reader.patch(buf, grid, 0, 0));
          }
          if (patches.length) icons.push({ name: name, w: w, h: h, patches: patches }); else failed.push(name + " (icon " + w + "x" + h + " too big)");
        } catch (e) { failed.push(name + " (unreadable: " + e.message + ")"); }
        finish();
      };
      img.src = "https://runescape.wiki/images/" + encodeURIComponent(name.replace(/ /g, "_")) + ".png";
    });
  }
  /* the tooltip only exists while the mouse is on the item, so the capture has to take itself */
  function delayedCapture(out) {
    var note = document.createElement("div"); out.appendChild(note);
    var left = 4, t = setInterval(function () {
      note.textContent = "capturing in " + left + "...";
      if (left-- > 0) return;
      clearInterval(t);
      var lines = [], m = mousePos(), full = null;
      try { full = Reader.fullCapture(); } catch (e) { lines.push("capture failed: " + e.message); }
      lines.push("mouse: " + (m ? m.x + "," + m.y : "not over the game"));
      try {
        var tip = m ? readTip(m) : null;
        lines.push("tooltip: " + (tip ? "box at " + JSON.stringify(tip.area) + "  name: " + JSON.stringify(tip.text) + (tip.text ? "  (" + tip.font + ")" : "  " + tip.why + "  colours: " + (tip.colours || []).join("  ")) : "no box found"));
      } catch (e2) { lines.push("tooltip reader crashed: " + e2.message); }
      if (full && m) {
        var px = [], dy;
        for (dy = 10; dy <= 60; dy += 10) { var q = ((m.y + dy) * full.width + m.x) * 4; px.push("+" + dy + ":" + full.data[q] + "," + full.data[q + 1] + "," + full.data[q + 2]); }
        lines.push("pixels below the mouse: " + px.join("  "));
      }
      note.textContent = lines.join("\n") + "\n";
      if (full) {
        var cv = document.createElement("canvas"); cv.width = full.width; cv.height = full.height;
        var id = cv.getContext("2d").createImageData(full.width, full.height); id.data.set(full.data); cv.getContext("2d").putImageData(id, 0, 0);
        var a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "bankwise-hover-capture.png"; a.textContent = "Download the hover capture (PNG)";
        note.appendChild(a);
      }
    }, 1000);
  }

  /* ---------- start ---------- */
  $("version").textContent = "v" + VERSION;
  applySettingsToUI();
  Data.onChange(function () { overlaySig = ""; if (view) { render(); drawOverlay(); } renderGear(); });
  fetch("./data/gear.json?v=" + VERSION).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) { Gear.load(j); overlaySig = ""; renderGear(); } }).catch(function () { /* best gear then works from the wiki alone */ });
  Data.loadPrices();
  /* the wiki icon library: this computer's own build first, else the one shipped with the app */
  WikiBuild.loadLocal().then(function (raw) {
    if (raw && raw.names && raw.names.length && raw.patches && raw.patches.length === raw.names.length * WikiLib.BYTES) return setWiki(raw, raw.shipped ? "shipped with the app" : (raw.complete === false ? "partial build" : "built") + " on this computer");
    return WikiBuild.loadShipped(VERSION).then(function (shipped) {
      setWiki(shipped, "shipped with the app");
      if (shipped) { shipped.shipped = true; WikiBuild.save(shipped).catch(function () { /* fetched again next time */ }); }   /* 20 MB: fetch it once, not at every start */
    });
  }).catch(function () { setWiki(null, ""); });
  /* a starter library shipped with the app, so nobody begins from nothing */
  fetch("./data/seed-library.json?v=" + VERSION).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j) return;
    var seed = Library.fromJSON(j), n = 0;
    seed.samples.forEach(function (sm) { if (lib.add(sm.name, sm.patch, "seed")) n++; });
    if (j.colours) for (var nm in j.colours) if (!nameColours[nm]) nameColours[nm] = j.colours[nm];
    seedInfo = seed.names().length + " items in the starter library, " + n + " new to this computer";
    if (n) { libVersion++; saveLibrary(); }
  }).catch(function () { seedInfo = "no starter library"; });
  if (window.alt1) {
    try { alt1.identifyAppUrl("./appconfig.json"); } catch (e) { /* not fatal */ }
    window.addEventListener("beforeunload", function () { overlaySig = overlaySig || "x"; clearOverlay(); });
  }
  render(); tick();
  setInterval(tick, READ_MS);
  setInterval(hoverTick, HOVER_MS);
  window.Bankwise = { _seen: function () { return seen; }, _redraw: function () { overlaySig = ""; drawOverlay(); }, _wiki: function () { return wiki; }, _setWiki: setWiki, _view: function () { return view; }, _lib: function () { return lib; }, _teach: teach, _tick: tick, _settings: settings, cleanName: cleanName };
})();
