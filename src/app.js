/* Bankwise - the app window: reads the bank, learns items as the player hovers them,
   draws value/verdict markers over the game and explains each verdict. */
(function () {
  "use strict";
  var VERSION = "0.4.0";
  var READ_MS = 700, HOVER_MS = 250, OVERLAY_MS = 5000, OVERLAY_GROUP = "bankwise";
  function $(id) { return document.getElementById(id); }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  function loadJSON(k, fallback) { try { var v = JSON.parse(store.get(k) || "null"); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; } }

  var DEFAULTS = { template: "five", junkBelow: 500, useQuests: false, useSkills: false, goalLevel: 99, useOverrides: false, overrides: {}, overlay: true, rmUser: "", teach: true };
  var settings = loadJSON("bankwise.settings.v1", {}), k;
  for (k in DEFAULTS) if (settings[k] === undefined) settings[k] = DEFAULTS[k];
  var profile = loadJSON("bankwise.profile.v1", null);
  var lib = Library.fromJSON(loadJSON("bankwise.library.v1", null)), libVersion = 1, libSaveTimer = null, libSaveFailed = false;

  lib.names().forEach(function (n) { if (/^(withdraw|deposit)(-\S+)?$/i.test(n) || n.length < 3) lib.forget(n); });   /* v0.2.x could learn the action word as a name */

  var nameColours = loadJSON("bankwise.namecolours.v1", {}), tipColour = null;   /* the colour the game draws each item's name in - it means something, not yet known what */

  var view = null;              /* last successful read: {grid, slots, buf} with identities on the slots */
  var idCache = {}, idCacheVersion = 0;
  var clean = {};               /* position -> the slot as seen while the mouse was elsewhere (what gets taught) */
  var shown = null;             /* what the detail card shows: {slot} from the bank or {name} from the list */
  var hoverSlot = null, tipName = "", tipCount = 0, tipRaw = "", tipArea = null, tipWhy = "", lastTaught = "";
  var seedInfo = "not loaded yet";
  var filter = "all", overlaySig = "", overlayAt = 0, lastError = "";

  function saveSettings() { store.set("bankwise.settings.v1", JSON.stringify(settings)); }
  function saveLibrary() {
    clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(function () { libSaveFailed = !store.set("bankwise.library.v1", JSON.stringify(lib.toJSON())); renderLibStatus(); }, 800);
  }

  /* ---------- identify ---------- */
  function named(s) { return s.id.state === "known" || s.id.state === "twin"; }   /* twin = identical icon shared by several items */
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
  function info(name) {
    var it = Data.describe(name);
    it.kind = Kinds.kindOf(name, it.cats);
    it.tab = Kinds.tabFor(it.kind, settings.template);
    it.verdict = Verdict.judge(it, settings, profile, Kinds);
    it.tier = Verdict.tier(it.price);
    return it;
  }

  /* ---------- overlay ---------- */
  var COL = null;
  function colours() {
    if (COL) return COL;
    var m = A1lib.mixColor;
    COL = { red: m(208, 74, 58), amber: m(224, 160, 48), t1: m(78, 165, 106), t2: m(69, 181, 196), t3: m(111, 155, 255), t4: m(176, 124, 255), t5: m(240, 192, 64), tag: m(255, 255, 255), warn: m(255, 120, 80) };
    return COL;
  }
  function overlayOk() { return window.alt1 && alt1.permissionOverlay && settings.overlay; }
  function clearOverlay() {
    if (!window.alt1 || !alt1.permissionOverlay || !overlaySig) return;
    try { alt1.overLaySetGroup(OVERLAY_GROUP); alt1.overLayClearGroup(OVERLAY_GROUP); alt1.overLaySetGroup(""); } catch (e) { /* older Alt1 */ }
    overlaySig = "";
  }
  function drawOverlay() {
    if (!overlayOk() || !view) { clearOverlay(); return; }
    var sig = view.slots.map(function (s) { return posKey(s) + ":" + s.id.state[1] + (named(s) ? s.id.name : ""); }).join("|") + "#" + Data.status.prices + Data.status.facts, now = Date.now();
    if (sig === overlaySig && now - overlayAt < OVERLAY_MS - 1500) return;
    var c = colours();
    try {
      alt1.overLaySetGroup(OVERLAY_GROUP);
      if (alt1.overLayFreezeGroup) alt1.overLayFreezeGroup(OVERLAY_GROUP);
      alt1.overLayClearGroup(OVERLAY_GROUP);
      view.slots.forEach(function (s) {
        if (s.id.state === "covered") return;
        var inset = Math.round(s.w * 0.07);
        if (s.id.state === "unknown") { alt1.overLayRect(c.red, s.x + inset, s.y + inset, s.w - 2 * inset, s.h - 2 * inset, OVERLAY_MS, 2); return; }
        if (s.id.state === "unsure") { alt1.overLayRect(c.amber, s.x + inset, s.y + inset, s.w - 2 * inset, s.h - 2 * inset, OVERLAY_MS, 2); return; }
        var it = info(s.id.name);
        if (s.id.state === "twin") alt1.overLayRect(c.amber, s.x + inset, s.y + inset, 4, 4, OVERLAY_MS, 2);      /* shares its icon with other items */
        if (c[it.tier.id]) alt1.overLayRect(c[it.tier.id], s.x + inset, s.y + s.h - inset - 2, s.w - 2 * inset, 2, OVERLAY_MS, 2);
        if (it.verdict.tag) {
          var col = it.verdict.id === "keep" ? c.tag : c.warn, size = Math.max(9, Math.round(s.w * 0.25));
          if (alt1.overLayTextEx) alt1.overLayTextEx(it.verdict.tag, col, size, s.x + s.w - inset - Math.round(size * 0.45), s.y + s.h - inset - Math.round(size * 0.8), OVERLAY_MS, "", true, true);
          else alt1.overLayText(it.verdict.tag, col, size, s.x + s.w - inset - size, s.y + s.h - inset - size, OVERLAY_MS);
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
    view = r;
    render(); drawOverlay();
  }
  function setStatus(text, warn) { var el = $("status"); el.textContent = text; el.className = warn ? "warn" : ""; }

  /* ---------- hover to teach ---------- */
  /* the tooltip reader already separates the action from the name (by colour); this only tidies */
  function cleanName(raw) {
    var t = String(raw || "").replace(/\s+/g, " ").replace(/^[^A-Za-z0-9'(]+|[^A-Za-z0-9')+]+$/g, "").trim();
    return /^(withdraw|deposit)(-\S+)?$/i.test(t) ? "" : t;
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
    if (!view || !window.TipReader || !window.alt1 || !settings.teach) return;
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
    if (tipCount === 2) { if (tipColour) { nameColours[name] = tipColour; store.set("bankwise.namecolours.v1", JSON.stringify(nameColours)); } teach(slot, name); }
    renderCard();
  }
  function teach(slot, name, force) {
    var src = clean[posKey(slot)] || slot, was = slot.id.state;
    if (!force && named(slot) && slot.id.name === name) return;
    /* only a correction typed by the player removes what was there: different items can share one
       identical icon, and the tooltip naming one of them must not make the app forget the others */
    if (force && slot.id.name && slot.id.name !== name && slot.id.state !== "unknown") lib.unlearn(slot.id.name, src.patch);
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
    var known = 0, unsure = 0, unknown = 0;
    view.slots.forEach(function (s) { if (named(s)) known++; else if (s.id.state === "unsure") unsure++; else if (s.id.state !== "covered") unknown++; });
    setStatus(unknown + unsure ? (settings.teach ? "Sweep your mouse over the boxed items so I can learn them." : "Learning is off. Turn on Teach to learn the boxed items.") : "Every item on screen is known.", false);
    $("counts").innerHTML = "<span><b>" + view.slots.length + "</b> on screen</span><span><b>" + known + "</b> known</span><span><b>" + (unknown + unsure) + "</b> to teach</span><span><b>" + lib.names().length + "</b> in library</span>";
    renderList(); renderCard();
  }
  function renderList() {
    var rows = [], seen = {};
    view.slots.forEach(function (s) {
      if (s.id.state === "covered") return;
      if (!named(s)) { rows.push({ slot: s, teach: true, price: -1 }); return; }
      if (seen[s.id.name]) return;
      seen[s.id.name] = 1;
      var it = info(s.id.name); rows.push({ slot: s, it: it, price: it.price === null ? -0.5 : it.price });
    });
    rows = rows.filter(function (r) { return filter === "all" || (filter === "teach" ? r.teach : (r.it && r.it.verdict.id === filter)); });
    rows.sort(function (a, b) { return b.price - a.price; });
    var html = rows.map(function (r, i) {
      var img = slotImg(r.slot);
      if (r.teach) return '<div class="item" data-i="' + i + '"><div class="mini" style="background-image:url(' + img + ')"></div><div class="nm"><span class="chip ' + (r.slot.id.state === "unsure" ? "unsure" : "teach") + '">' + (r.slot.id.state === "unsure" ? "unsure" : "new") + "</span> " + (r.slot.id.state === "unsure" ? esc(r.slot.id.name) + "?" : "hover it in the bank") + "</div></div>";
      return '<div class="item" data-i="' + i + '"><div class="mini" style="background-image:url(' + img + ')"></div><div class="nm">' + (r.it.verdict.id !== "keep" ? '<span class="chip ' + r.it.verdict.id + '">' + r.it.verdict.id + "</span> " : "") + esc(r.it.name) + '</div><div class="tabn">tab ' + r.it.tab.number + '</div><div class="pr ' + r.it.tier.id + '">' + Verdict.gp(r.it.price) + "</div></div>";
    }).join("");
    html = html || '<div class="empty">Nothing in this filter.</div>';
    if (html !== $("list")._html) { $("list").innerHTML = html; $("list")._html = html; }   /* untouched when nothing changed: keeps scroll and hover steady */
    $("list")._rows = rows;
  }
  function renderCard() {
    var s = shown && shown.slot, live = s && view && view.slots.indexOf(s) >= 0;
    if (s && !live && view) { var pk = posKey(s); s = null; view.slots.forEach(function (q) { if (posKey(q) === pk) s = q; }); if (s) shown.slot = s; }
    if (!s) { $("hicon").style.backgroundImage = ""; $("hname").textContent = view ? "Hover an item" : "Open your bank"; $("hprice").innerHTML = "&nbsp;"; $("hverdict").innerHTML = view ? "Hover an item in the bank, or a row below, to see what it is worth, where it belongs and whether to keep it." : "&nbsp;"; $("htab").innerHTML = "&nbsp;"; $("hpins").style.display = settings.useOverrides ? "" : "none"; $("hpins").style.visibility = "hidden"; $("hfix").style.visibility = "hidden"; return; }
    $("hicon").style.backgroundImage = "url(" + slotImg(s) + ")";
    $("hfix").style.visibility = ""; $("hpins").style.display = settings.useOverrides ? "" : "none";
    if (!named(s)) {
      $("hname").style.color = "";
      $("hname").textContent = s.id.state === "unsure" ? s.id.name + "?" : "Unknown item";
      $("hprice").innerHTML = hoverSlot === s ? (tipName ? "reading: <b>" + esc(tipName) + "</b>" : "keep the mouse still until the game shows its name") : "&nbsp;";
      $("hverdict").innerHTML = '<span class="chip ' + (s.id.state === "unsure" ? "unsure" : "teach") + '">' + (s.id.state === "unsure" ? "unsure" : "new") + "</span>" + (s.id.state === "unsure" ? "Looks like " + esc(s.id.name) + (s.id.rival ? " or " + esc(s.id.rival) : "") + ". Hover it in the bank to confirm." : "Hover it in the bank and I will remember it from then on.");
      $("htab").innerHTML = "&nbsp;"; $("hpins").style.visibility = "hidden";
      return;
    }
    var it = info(s.id.name);
    $("hname").textContent = it.name;
    $("hname").style.color = nameColours[it.name] ? "rgb(" + nameColours[it.name].join(",") + ")" : "";
    $("hprice").innerHTML = it.price !== null ? "<b>" + Verdict.gp(it.price) + "</b> each" + (it.alch ? " &middot; alch " + Verdict.gp(it.alch) : "") : (it.tradeable === false ? "not tradeable" : "price not loaded");
    $("hverdict").innerHTML = '<span class="chip ' + it.verdict.id + '">' + it.verdict.id + "</span>" + esc(it.verdict.reason) +
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
    $("templatetabs").innerHTML = t.tabs.map(function (tab) { return "<li><b>" + esc(tab[0]) + "</b> &mdash; " + tab[1].map(function (kd) { return esc(Kinds.KIND_LABEL[kd]); }).join(", ") + "</li>"; }).join("");
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
    el.textContent = msg || (parts.length ? "Loaded " + parts.join(" and ") + " for " + (profile.name || settings.rmUser) + " on " + new Date(profile.at).toLocaleDateString() + "." : "Only needed for the quest-log and skill-level options. Your RuneMetrics profile must be public.");
    el.className = "hint" + (bad ? " bad" : parts.length && !msg ? " ok" : "");
    $("rmbox").className = settings.useQuests || settings.useSkills ? "" : "off";
    $("rmurls").innerHTML = RuneMetrics.urls($("rmuser").value || "YourName").map(esc).join("<br>");
  }
  function applySettingsToUI() {
    $("template").innerHTML = Kinds.TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + "</option>"; }).join("");
    $("template").value = settings.template; $("junkbelow").value = settings.junkBelow; $("goallevel").value = settings.goalLevel;
    $("usequests").checked = settings.useQuests; $("useskills").checked = settings.useSkills; $("useoverrides").checked = settings.useOverrides;
    $("overlay").checked = settings.overlay; $("teach").checked = settings.teach; $("rmuser").value = settings.rmUser;
    renderTemplate(); renderLibStatus(); renderProfile();
  }
  function changed() { saveSettings(); overlaySig = ""; if (view) { render(); drawOverlay(); } renderProfile(); }

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
  Array.prototype.forEach.call($("filters").querySelectorAll("button"), function (b) {
    b.addEventListener("click", function () { filter = b.getAttribute("data-f"); Array.prototype.forEach.call($("filters").querySelectorAll("button"), function (o) { o.className = o === b ? "on" : ""; }); if (view) renderList(); });
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
  Data.onChange(function () { overlaySig = ""; if (view) { render(); drawOverlay(); } });
  Data.loadPrices();
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
  window.Bankwise = { _view: function () { return view; }, _lib: function () { return lib; }, _teach: teach, _tick: tick, _settings: settings, cleanName: cleanName };
})();
