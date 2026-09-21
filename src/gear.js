/* Best gear in the bank, by combat style.

   Tiers, slots and level requirements come first from the gear ladders curated for the Loadout
   Advisor (data/gear.json - checked against the game after the 2026 combat changes); gear that is
   not on those ladders falls back to what its wiki page says. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Gear = factory();
})(this, function () {
  "use strict";
  var STYLES = ["melee", "ranged", "magic", "necromancy"];
  var SLOTS = [["twohand", "Two-handed"], ["mainhand", "Main hand"], ["offhand", "Off-hand"], ["shield", "Shield"], ["head", "Head"], ["body", "Body"], ["legs", "Legs"], ["hands", "Hands"], ["feet", "Feet"],
    ["neck", "Neck"], ["ring", "Ring"], ["cape", "Cape"], ["pocket", "Pocket"], ["ammo", "Ammo"]];
  var SKILL_ID = { attack: 0, defence: 1, strength: 2, constitution: 3, ranged: 4, prayer: 5, magic: 6, cooking: 7, woodcutting: 8, fletching: 9, fishing: 10, firemaking: 11, crafting: 12, smithing: 13, mining: 14, herblore: 15,
    agility: 16, thieving: 17, slayer: 18, farming: 19, runecrafting: 20, hunter: 21, construction: 22, summoning: 23, dungeoneering: 24, divination: 25, invention: 26, archaeology: 27, necromancy: 28 };
  var items = {};

  function load(json) { items = json && json.items || {}; return Object.keys(items).length; }
  /* "Amulet of glory (4)" and "Ring of Wealth (3)" are the same gear as the bare name */
  function lookup(name) {
    var k = String(name || "").toLowerCase();
    return items[k] || items[k.replace(/\s*\((\d+|new|e|i|t|g|uncharged|charged|full|empty)\)$/, "")] || null;
  }
  /* the wiki's words for a slot -> ours */
  function slotOf(text) {
    var t = String(text || "").toLowerCase();
    if (/2h|two/.test(t)) return "twohand";
    if (/shield/.test(t)) return "shield";
    if (/off/.test(t)) return "offhand";
    if (/main|weapon/.test(t)) return "mainhand";
    if (/head|helm/.test(t)) return "head";
    if (/body|torso/.test(t)) return "body";
    if (/leg/.test(t)) return "legs";
    if (/hand|glove/.test(t)) return "hands";
    if (/feet|boot/.test(t)) return "feet";
    if (/neck/.test(t)) return "neck";
    if (/ring/.test(t)) return "ring";
    if (/cape|back/.test(t)) return "cape";
    if (/pocket/.test(t)) return "pocket";
    if (/ammo|quiver/.test(t)) return "ammo";
    return "";
  }
  /* one described piece of gear, from the ladder or from the wiki page's stats box (wiki = Data.gearFor's object) */
  function describe(name, wiki) {
    var c = lookup(name);
    if (c) return { name: name, slot: c.s, tier: c.t || 0, rank: c.i || 0, styles: c.st, levels: c.l || {}, curated: true };
    if (!wiki || !wiki.slot) return null;
    var slot = slotOf(wiki.slot), cls = String(wiki.cls || "").toLowerCase(), style = /rang/.test(cls) ? "ranged" : /mag/.test(cls) ? "magic" : /necro/.test(cls) ? "necromancy" : /melee/.test(cls) ? "melee" : "all";
    if (!slot) return null;
    var levels = {}, m, re = /(\d+)\s+([A-Za-z]+)/g;
    while ((m = re.exec(String(wiki.stats && wiki.stats.needs || "")))) if (SKILL_ID[m[2].toLowerCase()] !== undefined) levels[m[2].toLowerCase()] = +m[1];
    return { name: name, slot: slot, tier: wiki.tier || 0, rank: 0, styles: [style], levels: levels, curated: false };
  }
  /* which requirements the player does not meet: [] = wearable; levels = RuneMetrics levels by skill id, or null = unknown */
  function missing(piece, levels) {
    var out = [], k;
    if (!levels) return out;
    for (k in piece.levels) if ((levels[SKILL_ID[k]] || 1) < piece.levels[k]) out.push(piece.levels[k] + " " + k.charAt(0).toUpperCase() + k.slice(1));
    return out;
  }
  /* pieces = describe() results for everything seen in the bank -> per slot {best, locked}:
     best = the highest tier the player can wear (any, when levels is null), locked = a better piece they cannot wear yet */
  function best(pieces, style, levels) {
    var out = {};
    SLOTS.forEach(function (s) { out[s[0]] = { best: null, locked: null }; });
    function better(a, b) { return !b || a.tier > b.tier || (a.tier === b.tier && a.rank > b.rank); }
    pieces.forEach(function (p) {
      if (!p || !out[p.slot] || (p.styles.indexOf(style) < 0 && p.styles.indexOf("all") < 0)) return;
      var miss = missing(p, levels), o = out[p.slot];
      if (!miss.length) { if (better(p, o.best)) o.best = p; }
      else if (better(p, o.locked)) o.locked = { name: p.name, tier: p.tier, rank: p.rank, needs: miss };
    });
    SLOTS.forEach(function (s) { var o = out[s[0]]; if (o.locked && o.best && !better(o.locked, o.best)) o.locked = null; });
    return out;
  }
  return { load: load, lookup: lookup, describe: describe, best: best, missing: missing, slotOf: slotOf, STYLES: STYLES, SLOTS: SLOTS, SKILL_ID: SKILL_ID };
});
