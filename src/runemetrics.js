/* Optional: the player's skill levels and quest log from RuneMetrics, by username.

   RuneMetrics answers only for profiles set to public.  Browsers may refuse the plain
   request (no cross-origin header), so each lookup is tried as fetch first and as JSONP
   second; if both fail the settings panel offers pasting the JSON instead. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RuneMetrics = factory();
})(this, function () {
  "use strict";
  var BASE = "https://apps.runescape.com/runemetrics/";
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
    return get(BASE + "profile/profile?user=" + u + "&activities=0").then(function (j) { var p = parseProfile(j); out.levels = p.levels; if (p.name) out.name = p.name; })
      .catch(function (e) { out.notes.push("skills: " + e.message); })
      .then(function () { return get(BASE + "quests?user=" + u); }).then(function (j) { out.quests = parseQuests(j); })
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
  return { lookup: lookup, fromPaste: fromPaste, parseProfile: parseProfile, parseQuests: parseQuests, urls: function (user) { var u = encodeURIComponent(String(user || "").trim()); return [BASE + "profile/profile?user=" + u + "&activities=0", BASE + "quests?user=" + u]; } };
});
