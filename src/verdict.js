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

  /* cutoffs (optional): the player's own five "worth at least" figures for t1..t5, in any order of size */
  function tier(price, cutoffs) {
    if (price === null || price === undefined) return { id: "tx", label: "no price" };
    var i;
    if (cutoffs && cutoffs.length) {
      var best = -1;
      for (i = 0; i < cutoffs.length; i++) if (price >= cutoffs[i] && (best < 0 || cutoffs[i] >= cutoffs[best])) best = i;
      return best < 0 ? { id: "t0", label: "below the first cutoff" } : { id: "t" + (best + 1), label: short(cutoffs[best]) + "+" };
    }
    for (i = 0; i < TIERS.length; i++) if (price >= TIERS[i][0]) return { id: TIERS[i][1], label: TIERS[i][2] };
    return { id: "t0", label: "under 1k" };
  }
  /* the game's own shorthand, three figures, never rounded up: 950, 12.3K, 1.23M, 2.5B */
  function short(n) {
    if (n === null || n === undefined) return "-";
    var u = [[1e9, "B"], [1e6, "M"], [1e3, "K"]], i;
    for (i = 0; i < u.length; i++) if (n >= u[i][0]) {
      var v = n / u[i][0], m = v >= 100 ? 1 : v >= 10 ? 10 : 100;
      return String(Math.floor(v * m + 1e-9) / m) + u[i][1];
    }
    return String(Math.floor(n));
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

  /* the skill that decides whether a piece of gear is still worth wearing: armour goes by Defence, weapons by their style */
  function gearSkill(gear, kind) {
    if (kind === "armour") return 1;
    var c = String(gear.cls || "").toLowerCase();
    return /rang/.test(c) ? 4 : /mag/.test(c) ? 6 : /necro/.test(c) ? 28 : 0;
  }

  /* which quest does this item belong to?  quest items sit in a wiki category named after the quest */
  function questOf(item, profile) {
    if (!profile || !profile.quests) return null;
    for (var i = 0; i < item.cats.length; i++) { var q = profile.quests[norm(item.cats[i])]; if (q) return q; }
    return null;
  }

  /* item = Data.describe() + {kind};  opts = {junkBelow, useQuests, useSkills, goalLevel, useOverrides, overrides};
     profile = {quests:{normalised title:{title,status}}, levels:[by skill id]} or null
     -> {id: keep|sell|alch|destroy|diango|review, tag, reason}
     Nothing is simply destroyed when it can be high-alched: the coins and the Magic XP beat nothing at all. */
  function judge(item, opts, profile, Kinds) {
    var v = decide(item, opts, profile, Kinds), alch = alchOf(item);
    if (v.id === "destroy" && alch > 0) {
      var magic = profile && profile.levels ? (profile.levels[6] || 1) : null;
      return { id: "alch", tag: v.tag || "J", reason: v.reason + " High alch it for " + gp(alch) + " rather than destroying it: coins and Magic XP instead of nothing." + (magic !== null && magic < 55 ? " (High Level Alchemy needs 55 Magic; you have " + magic + ".)" : "") };
    }
    return v;
  }
  /* high alch value: the Grand Exchange table for tradeables, else 60% of the shop value on the item's wiki page */
  function alchOf(item) {
    if (item.alch) return item.alch;
    var g = item.gear;
    return g && g.alchable !== false && g.value ? Math.floor(g.value * 0.6) : 0;
  }
  function decide(item, opts, profile, Kinds) {
    opts = opts || {};
    var pin = opts.useOverrides && opts.overrides && opts.overrides[norm(item.name)];
    if (pin === "keep") return { id: "keep", tag: "", reason: "You pinned this as always keep." };
    if (pin === "junk") return { id: item.tradeable ? "sell" : "destroy", tag: "J", reason: "You pinned this as junk." };

    if (item.diango) return { id: "diango", tag: "D", reason: "Reclaimable from Diango: keep it or destroy it as you like - he hands it back for free." };

    /* only things whose whole point is the quest: a teleport, rune or potion that a quest also uses keeps its own kind */
    if (item.kind === "quest") {
      var q = opts.useQuests ? questOf(item, profile) : null;
      if (q && q.status === "COMPLETED") return { id: "destroy", tag: "Q", reason: "Quest item for " + q.title + ", which you have finished. Check the wiki page for a post-quest use before dropping it." };
      if (q) return { id: "keep", tag: "K", reason: "Needed for " + q.title + " (" + (q.status === "STARTED" ? "in progress" : "not started") + ")." };
      return { id: "keep", tag: "K", reason: "Quest item." + (opts.useQuests ? " Could not tell which quest it belongs to." : " Turn on the quest check in settings to see whether you still need it.") };
    }

    if (item.kind === "keepsake") return { id: "keep", tag: "K", reason: "Quest reward that cannot be reclaimed - keep it." };
    if (item.upgradeable) return { id: "keep", tag: "", reason: "Upgradeable gear: it is upgraded rather than replaced, so keep it." };

    if (item.tradeable === null) return { id: "review", tag: "", reason: "Prices have not loaded, so there is no advice yet." };

    /* gear you have outgrown: tier below the tier your level lets you wear (level 72 -> tier 70) */
    if (opts.useSkills && profile && profile.levels && item.tradeable && item.gear && item.gear.tier && (item.kind === "weapon" || item.kind === "armour")) {
      var sk = gearSkill(item.gear, item.kind), lvl = profile.levels[sk] || 1, mine = Math.floor(lvl / 10) * 10;
      if (item.gear.tier < mine) return { id: "sell", tag: "J", reason: "Tier " + item.gear.tier + " " + (item.gear.cls || "") + (item.kind === "weapon" ? " weapon" : " armour") + ", and your " + SKILLS[sk] + " level of " + lvl + " lets you use tier " + mine + ": sell it." };
    }

    var supply = !!Kinds.SUPPLY[item.kind];
    if (supply && opts.useSkills && profile && profile.levels) {
      var ids = Kinds.TRAINS[item.kind] || [], goal = opts.goalLevel || 99, left = ids.filter(function (id) { return (profile.levels[id] || 1) < goal; });
      if (ids.length && !left.length) return { id: item.tradeable ? "sell" : "review", tag: item.tradeable ? "J" : "", reason: "Training supply, and " + ids.map(function (id) { return SKILLS[id]; }).join(" / ") + " already at your goal of " + goal + "." };
      if (left.length) return { id: "keep", tag: "", reason: "Training supply for " + left.map(function (id) { return SKILLS[id] + " (" + (profile.levels[id] || 1) + ")"; }).join(", ") + "." };
    }
    if (item.tradeable) {
      var cut = opts.junkBelow === undefined ? 500 : opts.junkBelow;
      if (!supply && item.price !== null && item.price < cut && ["weapon", "armour", "jewellery", "misc", "tools"].indexOf(item.kind) >= 0)
        return item.alch ? { id: "alch", tag: "J", reason: "Only worth " + gp(item.price) + " on the Grand Exchange and not a consumable: high alch it for " + gp(item.alch) + (item.alch > item.price ? ", which also beats selling." : " and the Magic XP rather than bothering to sell.") }
          : { id: "sell", tag: "J", reason: "Tradeable, worth " + gp(item.price) + " each, and not a consumable: sell it." };
      return { id: "keep", tag: "", reason: supply ? "Consumable supply - keep while you use it, sell when you stop." : "Tradeable, " + gp(item.price) + " each." };
    }
    if (!item.known) return { id: "review", tag: "", reason: "Not tradeable and the wiki has no page under this exact name." };
    return { id: "review", tag: "", reason: "Untradeable and not reclaimable - check the wiki before destroying it." };
  }

  return { judge: judge, alchOf: alchOf, LABEL: { keep: "keep", sell: "sell", alch: "high alch", destroy: "destroy", diango: "Diango", review: "review" }, tier: tier, short: short, gp: gp, norm: norm, SKILLS: SKILLS, TIERS: TIERS };
});
