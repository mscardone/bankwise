/* Keep, sell or destroy?  Advice only - the app never touches the game.

   Out of the box only wiki facts are used, so the advice is the same for everyone.
   The player can switch on, separately: their finished quests, their skill levels and
   a training goal, and their own per-item pins.  Rules run top to bottom; the first one
   that applies wins, and every verdict carries its reason so it can be argued with. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Verdict = factory();
})(this, function () {
  "use strict";
  var SKILLS = ["Attack", "Defence", "Strength", "Constitution", "Ranged", "Prayer", "Magic", "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting", "Smithing", "Mining", "Herblore", "Agility", "Thieving", "Slayer", "Farming", "Runecrafting", "Hunter", "Construction", "Summoning", "Dungeoneering", "Divination", "Invention", "Archaeology", "Necromancy"];
  var TIERS = [[1e7, "t5", "10m+"], [1e6, "t4", "1m+"], [1e5, "t3", "100k+"], [1e4, "t2", "10k+"], [1e3, "t1", "1k+"], [0, "t0", "under 1k"]];

  function tier(price) {
    if (price === null || price === undefined) return { id: "tx", label: "no price" };
    for (var i = 0; i < TIERS.length; i++) if (price >= TIERS[i][0]) return { id: TIERS[i][1], label: TIERS[i][2] };
    return { id: "t0", label: "under 1k" };
  }
  function gp(n) {
    if (n === null || n === undefined) return "-";
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "b";
    if (n >= 1e7) return Math.round(n / 1e6) + "m";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
    if (n >= 1e4) return Math.round(n / 1e3) + "k";
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  /* which quest does this item belong to?  quest items sit in a wiki category named after the quest */
  function questOf(item, profile) {
    if (!profile || !profile.quests) return null;
    for (var i = 0; i < item.cats.length; i++) { var q = profile.quests[norm(item.cats[i])]; if (q) return q; }
    return null;
  }

  /* item = Data.describe() + {kind};  opts = {junkBelow, useQuests, useSkills, goalLevel, useOverrides, overrides};
     profile = {quests:{normalised title:{title,status}}, levels:[by skill id]} or null
     -> {id: keep|sell|destroy|review, tag, reason} */
  function judge(item, opts, profile, Kinds) {
    opts = opts || {};
    var pin = opts.useOverrides && opts.overrides && opts.overrides[norm(item.name)];
    if (pin === "keep") return { id: "keep", tag: "", reason: "You pinned this as always keep." };
    if (pin === "junk") return { id: item.tradeable ? "sell" : "destroy", tag: "J", reason: "You pinned this as junk." };

    if (item.diango) return { id: "destroy", tag: "D", reason: "Reclaimable from Diango, so it is safe to destroy - he hands it back for free." };

    if (item.questItem || item.kind === "quest") {
      var q = opts.useQuests ? questOf(item, profile) : null;
      if (q && q.status === "COMPLETED") return { id: "destroy", tag: "Q", reason: "Quest item for " + q.title + ", which you have finished. Check the wiki page for a post-quest use before dropping it." };
      if (q) return { id: "keep", tag: "K", reason: "Needed for " + q.title + " (" + (q.status === "STARTED" ? "in progress" : "not started") + ")." };
      return { id: "keep", tag: "K", reason: "Quest item." + (opts.useQuests ? " Could not tell which quest it belongs to." : " Turn on the quest check in settings to see whether you still need it.") };
    }

    if (item.tradeable === null) return { id: "review", tag: "", reason: "Prices have not loaded, so there is no advice yet." };

    var supply = !!Kinds.SUPPLY[item.kind];
    if (supply && opts.useSkills && profile && profile.levels) {
      var ids = Kinds.TRAINS[item.kind] || [], goal = opts.goalLevel || 99, left = ids.filter(function (id) { return (profile.levels[id] || 1) < goal; });
      if (ids.length && !left.length) return { id: item.tradeable ? "sell" : "review", tag: item.tradeable ? "J" : "", reason: "Training supply, and " + ids.map(function (id) { return SKILLS[id]; }).join(" / ") + " already at your goal of " + goal + "." };
      if (left.length) return { id: "keep", tag: "", reason: "Training supply for " + left.map(function (id) { return SKILLS[id] + " (" + (profile.levels[id] || 1) + ")"; }).join(", ") + "." };
    }
    if (item.tradeable) {
      var cut = opts.junkBelow === undefined ? 500 : opts.junkBelow;
      if (!supply && item.price !== null && item.price < cut && ["weapon", "armour", "jewellery", "misc", "tools"].indexOf(item.kind) >= 0)
        return { id: "sell", tag: "J", reason: "Tradeable, worth " + gp(item.price) + " each, and not a consumable: sell it or alch it (" + gp(item.alch) + ")." };
      return { id: "keep", tag: "", reason: supply ? "Consumable supply - keep while you use it, sell when you stop." : "Tradeable, " + gp(item.price) + " each." };
    }
    if (!item.known) return { id: "review", tag: "", reason: "Not tradeable and the wiki has no page under this exact name." };
    return { id: "review", tag: "", reason: "Untradeable and not reclaimable - check the wiki before destroying it." };
  }

  return { judge: judge, tier: tier, gp: gp, norm: norm, SKILLS: SKILLS, TIERS: TIERS };
});
