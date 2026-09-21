/* Optional: the player's skill levels and quest log from RuneMetrics, by username.

   Jagex's player APIs send no cross-origin header, so a web page cannot read them directly.
   Lookups go through a small Cloudflare Worker that only relays them (the same one the
   DailyScape Advisor uses; source in that repo, worker/dailyscape-proxy.worker.js):
     /profile  RuneMetrics profile - skill levels; fails when the profile is private
     /hiscores the hiscores table   - skill levels even for a private profile
     /quests   RuneMetrics quests   - empty when the profile is private
   The direct request and JSONP are still tried afterwards, and pasting the JSON is the last resort. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RuneMetrics = factory();
})(this, function () {
  "use strict";
  var BASE = "https://apps.runescape.com/runemetrics/";
  var PROXY = "https://dailyscape-proxy.scott-cardone.workers.dev";
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = "bankwise_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6), s = document.createElement("script"), done = false;
      function finish(f, v) { if (done) return; done = true; try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); f(v); }
      window[cb] = function (data) { finish(resolve, data); };
      s.onerror = function () { finish(reject, new Error("blocked or offline")); };
      setTimeout(function () { finish(reject, new Error("timed out")); }, 12000);
      s.src = url + (url.indexOf("?") < 0 ? "?" : "&") + "callback=" + cb;
      document.head.appendChild(s);
    });
  }
  function get(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).catch(function () { return jsonp(url); });
  }
  /* through the worker first; whatever it answers (even an error object) is an answer */
  function viaProxy(path, direct) {
    return fetch(PROXY + path).then(function (r) { return r.json(); }).catch(function () { return get(direct); });
  }
  /* hiscores index_lite: one "rank,level,xp" line per skill, Overall first, then the skills in RuneMetrics id order */
  function parseHiscores(text) {
    var rows = String(text || "").trim().split(/\r?\n/), levels = [], i;
    for (i = 1; i <= 29 && i < rows.length; i++) { var c = rows[i].split(","); if (c.length < 2 || isNaN(+c[1])) break; levels[i - 1] = Math.max(1, +c[1]); }
    if (levels.length < 20) throw new Error("the hiscores answer was not a skill table");
    return levels;
  }

  function parseProfile(j) {
    if (!j || j.error) throw new Error(j && j.error === "PROFILE_PRIVATE" ? "that RuneMetrics profile is private" : j && j.error === "NO_PROFILE" ? "no such player" : "unexpected answer" + (j && j.error ? ": " + j.error : ""));
    var levels = [];
    (j.skillvalues || []).forEach(function (s) { levels[s.id] = s.level; });
    if (!levels.length) throw new Error("the answer had no skill levels");
    return { name: j.name || "", levels: levels };
  }
  function parseQuests(j) {
    var out = {}, n = 0;
    ((j && j.quests) || []).forEach(function (q) { if (q && q.title) { out[norm(q.title)] = { title: q.title, status: q.status }; n++; } });
    if (!n) throw new Error("the answer had no quests (is the profile public?)");
    return out;
  }
  /* -> Promise<{name, levels, quests, at, notes:[]}>; rejects only when nothing at all could be read */
  function lookup(user) {
    var u = encodeURIComponent(String(user || "").trim()), out = { name: user, levels: null, quests: null, at: Date.now(), notes: [] };
    if (!u) return Promise.reject(new Error("type a username first"));
    return viaProxy("/profile?user=" + u, BASE + "profile/profile?user=" + u + "&activities=0").then(function (j) { var p = parseProfile(j); out.levels = p.levels; if (p.name) out.name = p.name; })
      .catch(function (e) {
        /* a private profile still has public hiscores */
        return fetch(PROXY + "/hiscores?user=" + u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(function (t) { out.levels = parseHiscores(t); })
          .catch(function () { out.notes.push("skills: " + e.message); });
      })
      .then(function () { return viaProxy("/quests?user=" + u, BASE + "quests?user=" + u); }).then(function (j) { out.quests = parseQuests(j); })
      .catch(function (e) { out.notes.push("quests: " + e.message); })
      .then(function () { if (!out.levels && !out.quests) throw new Error(out.notes.join("; ")); return out; });
  }
  /* pasted JSON from either RuneMetrics address */
  function fromPaste(text, into) {
    var j = JSON.parse(text), out = into || { name: "", levels: null, quests: null, at: Date.now(), notes: [] };
    if (j.quests) out.quests = parseQuests(j); else { var p = parseProfile(j); out.levels = p.levels; out.name = p.name || out.name; }
    out.at = Date.now();
    return out;
  }
  return { lookup: lookup, fromPaste: fromPaste, parseHiscores: parseHiscores, PROXY: PROXY, parseProfile: parseProfile, parseQuests: parseQuests, urls: function (user) { var u = encodeURIComponent(String(user || "").trim()); return [BASE + "profile/profile?user=" + u + "&activities=0", BASE + "quests?user=" + u]; } };
});
