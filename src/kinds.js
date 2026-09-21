/* What kind of thing an item is, and which bank tab that kind belongs in.

   An item gets ONE kind from the first rule that matches its name or its wiki
   categories.  A layout template is then just a list of tabs, each holding some kinds,
   so every template shares the same classifier and a new template is a few lines. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Kinds = factory();
})(this, function () {
  "use strict";

  /* [kind, name pattern, category pattern] - first match wins, so specific rules go first */
  var RULES = [
    ["clue", /clue scroll|sealed clue|puzzle casket|reward casket|scroll box|^casket|globetrotter|treasure trail/i, /treasure trails?( |$)|clue scrolls/i],
    ["quest", null, /^quest items$|quest items/i],
    ["holiday", /\b(christmas|santa|easter|hallowe'?en|pumpkin|cracker|party ?hat|partyhat|bunny ears|reindeer|snowman|jack lantern)\b/i, /holiday|seasonal|diango|discontinued|cosmetic|treasure hunter/i],
    ["currency", /^coins$|token|\bticket\b|\bvoucher\b|chimes|taijitu|\bmarks? of\b|tokkul|teci|zemomark|thaler|\bpoints?\b|oddments|bond$|wildcard$|\breset$|\brefresh$/i, /currenc/i],
    ["teleport", /teleport|\btablet\b|\bdramen\b|games necklace|ring of duelling|amulet of glory|skills necklace|combat bracelet|digsite pendant|ring of kinship|enlightened amulet|traveller's necklace|slayer ring|luck of the dwarves|wicked hood|ectophial|lodestone|sixth-age circuit|tokkul-zo|drakan's medallion|explorer's ring|ardougne cloak|karamja gloves|passage of the abyss|attuned crystal teleport seed|charter/i, /teleportation|teleport items/i],
    ["runes", /\brune$|\brunes$|rune \(|essence$|\bessence\b|talisman|tiara|runic|\bvis wax\b|magical thread|binding contract/i, /^runes$|runecrafting|talismans|tiaras/i],
    ["ammo", /arrows?( \(|$)|\bbolts?( \(|$)|\bdarts?( \(|$)|\bknives$|throwing|javelin|chinchompa|cannonball|\bbolt tips\b|arrowheads?|bakriminel|\bquiver\b|bone spike|ghostly ink|necroplasm|ritual candle/i, /^ammunition|arrows|bolts/i],
    /* a number in brackets is a dose on a potion but a charge on jewellery and a fill level on a few tools */
    ["teleport", /^(ring|amulet|necklace|bracelet|pendant) of .*\(\d+\)$|pharaoh's sceptre/i, null],
    ["seeds", /^watering can/i, null], ["tools", /^waterskin/i, null], ["divination", /^divine /i, null], ["slayer", /^slayer /i, null],
    ["potion", /\(\d\)$|\(\d\) ?\(|\bflask\b|potion|overload|\bbrew\b|\brestore\b|antifire|antipoison|antidote|weapon poison|\bvial\b|\bjuju\b|adrenaline|\bprayer renewal\b|aggression|powerburst|elder overload|vulnerability bomb|\bbomb$/i, /^potions?$|potions|flasks/i],
    ["seeds", /\bseeds?$|\bseed \(|sapling|seedling|\bspore\b|\bcompost\b|supercompost|ultracompost|plant cure|\bwatering can\b|\bsecateurs\b|\brake$|seed dibber|\btrowel\b|mushroom spore|\bbittercap\b|jade vine/i, /farming|^seeds$|saplings|^allotment|^trees?$/i],
    ["herblore", /^grimy|^clean |\bherb\b|unfinished|\(unf\)|eye of newt|limpwurt|snape grass|white berries|red spiders' eggs|wine of|dragon scale dust|unicorn horn|potato cactus|mort myre|crushed nest|ground |bird's nest|spider venom|primal extract|\bfruit\b.*fragment|bloodweed|arbuck|spirit weed|wergali|fellstalk|torstol|lantadyme|dwarf weed|cadantine|snapdragon|kwuarm|avantoe|\birit\b|toadflax|ranarr|harralander|tarromin|marrentill|guam/i, /herblore|^herbs$|secondary ingredients/i],
    ["food", /^raw |^cooked |shark|rocktail|sailfish|lobster|swordfish|monkfish|manta ray|cavefish|sea turtle|\bpie\b|\bcake\b|\bpizza\b|\bstew\b|\bsoup\b|\bkebab\b|blubber jellyfish|tuna|salmon|trout|bass|karambwan|saradomin brew|\bbread\b|\bmeat\b|\bcheese\b|\bwine\b|\bbeer\b|\bale\b|potato|summer pie|primal feast|\bjerky\b/i, /^food$|cooking|fish$|^fish\b/i],
    ["summoning", /pouch$|\bscroll\b|\bcharm$|\bcharms$|spirit shard|\bfamiliar\b|binding contract|ancient elven ritual shard|pack yak|titan|\bnihil\b/i, /summoning|familiars|charms/i],
    ["prayer", /ectoplasm|bucket of slime|bones?$|bones? \(|\bashes$|\bbonemeal\b|ensouled|\bincense\b|impious|accursed|infernal ashes|searing ashes|tortured ashes/i, /^bones$|^ashes$|prayer items|remains/i],
    ["wood", /\bwood spirit$|\blogs?$|\bplanks?$|\bshafts?$|\bshieldbow \(u\)|\bshortbow \(u\)|\(u\)$|bow ?string|\bflax\b|\bbranches\b|\broots?$|timber|refined plank|headless arrow|feathers?$|elder wood|\bstock$/i, /^logs$|^planks$|fletching|woodcutting|firemaking|construction materials/i],
    ["metal", /\bore$|\bbar$|\bcoal$|\bstone spirit|\bluminite\b|\bbane\w* ore|necrite|phasmatite|drakolith|orichalcite|animica|light animica|dark animica|corrupted ore|\bgold leaf\b|\bsalvage\b|burial|\bingot\b|primal bar|\bnails$|\bsmithing\b|protean bar|concentrated/i, /^ores$|^bars$|mining|smithing|salvage/i],
    ["gems", /uncut|sapphire$|emerald$|ruby$|diamond$|dragonstone$|onyx$|hydrix$|opal$|jade$|topaz$|\bgem\b|\bmolten glass\b|\bsoda ash\b|bucket of sand|\bseaweed\b|\bclay$|soft clay|\bthread$|\bneedle$|\bmould$|\bwool\b|bolt of cloth|\bsilver\b|battlestaff$|\borb$|\bglass\b|\bcrystal (shard|flask|glass)|harmonic dust|\bpottery\b|\burn\b/i, /^gems$|crafting/i],
    ["hides", /\bhide$|dragonhide$|\bleather$|hard leather|\bsnakeskin\b|\bfur$|\byak-hide\b|\bcarapace$|\bscales?$|dinosaur hide|\bspider silk\b|\bbatwing$|\bsubjugation\b.*\bshard|\bcowhide\b/i, /^hides$|tanned|leather/i],
    ["invention", /\bparts$|\bcomponents$|\bdivine charge\b|\baugmentor\b|\bgizmo\b|\bblueprint\b|\bsiphon\b|equipment (separator|dissolver)|\bmachine\b|\bpower cell\b|charge pack|\binspiration\b|\bscavenging\b|\bancient gizmo/i, /invention|^materials$/i],
    ["divination", /\bmemory$|\bmemories$|\benergy$|\bsign of\b|\bportent of\b|\bdivine (location|.* rock|.* tree|.* bush)|\bboon\b|\battuned\b|\bcache\b|guthixian|\bnavigator\b|incandescent|luminous|radiant|brilliant|lustrous|elder energy|\bhall of memories\b/i, /divination/i],
    ["archaeology", /\(damaged\)|\bartefact\b|\bsoil$|\bmattock\b|\btetracompass|third age iron|zarosian insignia|samite silk|imperial steel|white oak|goldrune|orthenglass|vellum|cadmium red|ancient vis|tyrian purple|leather scraps|chaotic brimstone|demonhide|eye of dagon|hellfire metal|keramos|white marble|cobalt blue|everlight silvthril|star of saradomin|blood of orcus|stormguard steel|wings of war|animal furs|armadylean yellow|malachite green|mark of the kyzaj|vulcanised rubber|warforged bronze|fossilised bone|yu'biusk clay|aetherium alloy|compass rose|felt|quintessence|carbon black|\bpylon battery\b|\bchronote|\brelic\b|\bcompleted tome|archaeolog/i, /archaeology/i],
    ["slayer", /\bslayer\b|\bensouled\b|\bmask of\b|\bhelm of\b|\brock hammer\b|bag of salt|ice cooler|fungicide|\bfishing explosive\b|mirror shield|earmuffs|nose ?peg|face ?mask|witchwood|\binsulated boots\b|spiny helmet|ferocious ring|\bcontract\b|\bcrystal motherlode shard|\bsuperior\b|\breaper\b|hydrix bolt tips|\bmimic\b|\bkill token/i, /^slayer|slayer equipment/i],
    ["outfit", /(lumberjack|fishing|golden mining|\w+ sentinel|magic golem|blacksmith|artisan|farmer|botanist|shaman|diviner|first age|sous chef|camo|ethereal|infinity ethereal|master runecrafter|nimble|skiller|constructor|trapper|volcanic trapper|arctic trapper|black ibis|factory|archaeologist|master archaeologist|warped gorajan|runecrafter|elder divination|factory)('s)? (torso|apron|chest|helm|trunks|branch|hat|top|legs|boots|gloves|outfit|head|body|hands|feet|robe|skirt|bottom|mask|chaps|jacket|chestplate|helmet|cuffs|trousers)|\boutfit\b|\bcape \(t\)$|max cape|completionist|master cape/i, /experience-boosting sets?|skilling outfits?|capes of accomplishment|skill capes/i],
    ["tools", /\bpickaxe\b|\bhatchet\b|\bharpoon\b|fishing rod|fly fishing|\bnet$|lobster pot|\bhammer$|\bchisel$|\bknife$|\bsaw$|tinderbox|\bspade$|\bshears$|pestle and mortar|\bbucket$|\bjug$|\bpot$|\bbowl$|crystal (saw|chisel|hammer|tinderbox|knife)|tool ?belt|\bbox trap\b|\bbird snare\b|\bnoose wand\b|\bbutterfly net\b|\brope$|\blantern\b|\bcandle\b|\btorch$|grapple|\bbait$|\bstripy feather|\burn enhancer|\bgrace of the elves\b|\bspring cleaner\b|\bseedicide\b|\bcharming imp\b|\bbonecrusher\b|herbicide|\bgem bag\b|coal bag|ore box|\bwood box\b|\bsoil box\b|\brune pouch\b|\bsign of the porter|\bpontifex\b|\bdwarven army axe|\bherb bag\b/i, /^tools$|tool items/i],
    ["jewellery", /\bring\b|\bamulet\b|\bnecklace\b|\bbracelet\b|\bpendant\b|\bbrooch\b|\bscrimshaw\b|\bsigil\b|\bpocket\b|\bsymbol$|\bbook of\b|\billuminated\b|\bgod book\b|\bbraclet\b|\breaver's\b|asylum surgeon|\bchannellers?\b|\bstalker's\b|\bchampion's ring|ring of (death|vigour|wealth|fortune|recoil|life)/i, /^rings$|^amulets$|^necklaces$|^bracelets$|jewellery|pocket slot/i],
    ["weapon", /sword|scimitar|\bdagger|\bmace$|\bmaul$|battleaxe|warhammer|halberd|\bspear$|\bhasta$|\bclaws?$|\bwhip$|rapier|longsword|\bblade$|\bcleaver|\bglaive|\bscythe$|\bkhopesh|\blance$|\bbow$|shortbow|shieldbow|longbow|crossbow|\bstaff$|staff of|\bwand$|\borb$|\bsingularity\b|\bchargebow|\bblowpipe\b|\bcannon\b|\bnoxious\b|\bdrygore\b|\bseismic\b|\bascension\b|\bzaros godsword|godsword|\bezk\b|\bfractured staff|\bbow of the last guardian|\beldritch\b|\bdark (bow|shard|sliver)|\bseren godbow|\blimitless\b|\bgreater \w+ ability codex|\bdefender$|\brepriser$|\brebounder$|\bgrimoire\b|\bomni guard|\bdeath guard|\bskull lantern|soulbound lantern|\bjaws of the abyss|\bvestments of havoc|\bleng\b|\bmasterwork spear|\babyssal\b|\bkorasi|\bbalmung|\bkeris|\bsilverlight|\bdarklight|\bexcalibur|\bsunspear|\bdragon rider lance|\bterrasaur maul|\bhexhunter|\binquisitor staff|\bblightbound|\bdecimation|\bwyvern crossbow|\bstrykebow|\bnox\b|\bcywir\b|\battuned crystal/i, /weapons?$|^weapons|main hand|off-hand|two-handed/i],
    ["armour", /\bhelm\b|\bhelmet\b|full helm|\bcoif\b|\bhat$|\bmask$|\bhood$|platebody|chainbody|\bbody$|\btop$|\brobe\b|\bchestplate\b|\bcuirass\b|\bhauberk\b|\bjacket\b|platelegs|plateskirt|\blegs$|\bchaps$|\btassets?\b|\bgreaves\b|\bbottoms?$|\bskirt$|\bboots$|\bgloves$|\bgauntlets$|\bvambraces$|\bbracers$|\bshield$|\bkiteshield\b|sq shield|\bward$|\bbuckler\b|\bcape$|\bcloak$|\bankou\b|\bbandos\b|\barmadyl\b|\bsubjugation\b|\btorva\b|\bpernix\b|\bvirtus\b|\bmalevolent\b|\bsirenic\b|\btectonic\b|\banima core\b|\bmasterwork\b|\btrimmed masterwork\b|\bcryptbloom\b|\belite \w+\b|\bdeathwarden|\bdeathdealer|\bfirst necromancer|\bgarb\b|\bvestments?\b|\bdragon rider\b|\bnex\b|\bbarrows\b|\bahrim|\bdharok|\bguthan|\bkaril|\btorag|\bverac|\bakrisae|\blinza|\bspider leg|\bsuperior \w+|\bvoid knight|\bfighter torso|\brune \w+$|\badamant \w+$|\bmithril \w+$|\bblack \w+$|\bsteel \w+$|\biron \w+$|\bbronze \w+$|\bdragon \w+$|\borikalkum \w+$|\bnecronium \w+$|\bbane \w+$|\belder rune \w+$|\bamulet of souls|\bhydrix/i, /armou?r$|^armou?r|head slot|body slot|legs slot|feet slot|hands? slot|shields?$|capes?$/i],
    ["keys", /\bportable\b|\bkey$|\bkey \(|\bkeys$|crystal key|\btooth half|\bloop half|\bmuddy key|\bsinister key|\bbrimhaven|\btriskelion|\bkey token|\bdungeoneering token|\bchallenge gem|\blamp$|\bstar$|\bprismatic\b|\bcinder core|\bradiant star|\bsilverhawk|\bproteans?\b|\bdummy$|\bspirit gem|\bknowledge bomb|\bbonus xp|\bbook of (char|knowledge)|\bxp (lamp|star)/i, /experience lamps?|keys$/i]
  ];

  var KIND_LABEL = {
    clue: "Clues", quest: "Quest items", holiday: "Holiday & cosmetic", currency: "Currency & tokens", teleport: "Teleports", runes: "Runes & runecrafting", ammo: "Ammunition",
    potion: "Potions", herblore: "Herblore supplies", food: "Food & cooking", summoning: "Summoning", prayer: "Bones & ashes", seeds: "Farming", wood: "Logs, planks & fletching",
    metal: "Ores & bars", gems: "Gems & crafting", hides: "Hides & leather", invention: "Invention", divination: "Divination", archaeology: "Archaeology", slayer: "Slayer",
    keepsake: "Quest rewards & keepsakes", outfit: "Skilling outfits & capes", tools: "Tools", jewellery: "Jewellery & pocket", weapon: "Weapons", armour: "Armour", keys: "Keys, lamps & boosts", misc: "Everything else"
  };
  /* kinds that are used up by playing: a low unit price does not make these junk */
  var SUPPLY = { runes: 1, ammo: 1, potion: 1, herblore: 1, food: 1, summoning: 1, prayer: 1, seeds: 1, wood: 1, metal: 1, gems: 1, hides: 1, invention: 1, divination: 1, archaeology: 1, teleport: 1, currency: 1 };
  /* skills a supply trains (RuneMetrics skill ids) - used only when the player turns that option on */
  var TRAINS = { prayer: [5], food: [7, 10], wood: [9, 11, 22, 8], metal: [13, 14], gems: [12], hides: [12], herblore: [15], seeds: [19], runes: [20], summoning: [23], divination: [25], invention: [26], archaeology: [27] };

  /* a name that says "sword" or "amulet" is still a quest item when the wiki files it under quest items;
     things that are plainly supplies keep their own kind whatever else they are */
  var QUEST_YIELDS_TO = { clue: 1, currency: 1, teleport: 1, runes: 1, ammo: 1, potion: 1, seeds: 1, herblore: 1, food: 1, prayer: 1, wood: 1, metal: 1, gems: 1, hides: 1 };
  function kindOf(name, cats) {
    var i, j, r, n = String(name || ""), byName = null;
    cats = cats || [];
    for (i = 0; i < RULES.length && !byName; i++) {
      r = RULES[i];
      if (r[1] && r[1].test(n)) byName = r[0];
    }
    if (!byName || !QUEST_YIELDS_TO[byName]) {
      /* a quest reward that Diango (or anyone) will not hand back is a keepsake, whatever it looks like */
      var reward = false, reclaim = false;
      for (j = 0; j < cats.length; j++) { if (/quest rewards?/i.test(cats[j])) reward = true; if (/diango|reclaim/i.test(cats[j])) reclaim = true; }
      if (reward && !reclaim) return "keepsake";
      if (byName) for (j = 0; j < cats.length; j++) if (/^quest items$/i.test(cats[j])) return "quest";
    }
    if (byName) return byName;
    for (i = 0; i < RULES.length; i++) {
      r = RULES[i];
      if (r[2]) for (j = 0; j < cats.length; j++) if (r[2].test(cats[j])) return r[0];
    }
    return "misc";
  }

  /* ---------- layout templates ---------- */
  var TEMPLATES = [
    { id: "five", name: "Five-tab essentials", blurb: "The layout most guides agree on: an inbox, gear, combat supplies, skilling, and things to sell.",
      tabs: [["Inbox (sort me)", ["misc"]], ["Gear", ["weapon", "armour", "jewellery", "ammo", "runes", "teleport", "slayer"]], ["Combat supplies", ["potion", "food", "summoning", "prayer", "herblore"]],
        ["Skilling", ["tools", "outfit", "wood", "metal", "gems", "hides", "seeds", "invention", "divination", "archaeology"]], ["Loot, quest & keepsakes", ["clue", "quest", "holiday", "keepsake", "currency", "keys"]]] },
    { id: "pvm", name: "PvM-focused", blurb: "Gear split by what you grab before a boss; skilling squeezed into two tabs.",
      tabs: [["Inbox (sort me)", ["misc"]], ["Weapons & ammo", ["weapon", "ammo", "runes"]], ["Armour", ["armour"]], ["Jewellery & teleports", ["jewellery", "teleport"]],
        ["Potions & food", ["potion", "food", "prayer"]], ["Familiars & Slayer", ["summoning", "slayer"]], ["Skilling supplies", ["herblore", "wood", "metal", "gems", "hides", "seeds", "invention", "divination", "archaeology"]],
        ["Tools & outfits", ["tools", "outfit"]], ["Loot, clues & keepsakes", ["clue", "quest", "holiday", "keepsake", "currency", "keys"]]] },
    { id: "skiller", name: "Skiller", blurb: "One tab per family of skills; combat gear kept together out of the way.",
      tabs: [["Inbox (sort me)", ["misc"]], ["Tools, outfits & teleports", ["tools", "outfit", "teleport", "jewellery"]], ["Gathering: wood & metal", ["wood", "metal"]], ["Herblore & Farming", ["herblore", "seeds", "potion"]],
        ["Cooking & Prayer", ["food", "prayer"]], ["Crafting & Runecrafting", ["gems", "hides", "runes"]], ["Invention, Divination & Archaeology", ["invention", "divination", "archaeology"]],
        ["Combat gear", ["weapon", "armour", "ammo", "summoning", "slayer"]], ["Clues, quest & keepsakes", ["clue", "quest", "holiday", "keepsake", "currency", "keys"]]] },
    { id: "granular", name: "Granular (14 tabs)", blurb: "Nearly one tab per kind, for big banks where five tabs become a wall of icons.",
      tabs: [["Inbox (sort me)", ["misc"]], ["Weapons", ["weapon"]], ["Armour", ["armour"]], ["Jewellery & teleports", ["jewellery", "teleport"]], ["Ammo & runes", ["ammo", "runes"]], ["Potions & herblore", ["potion", "herblore"]],
        ["Food, bones & ashes", ["food", "prayer"]], ["Summoning & Slayer", ["summoning", "slayer"]], ["Wood & fletching", ["wood"]], ["Ores, bars, gems & hides", ["metal", "gems", "hides"]], ["Farming", ["seeds"]],
        ["Invention, Divination & Archaeology", ["invention", "divination", "archaeology"]], ["Tools & outfits", ["tools", "outfit"]], ["Clues, quest, currency & keepsakes", ["clue", "quest", "holiday", "keepsake", "currency", "keys"]]] },
    /* Scott's own bank.  The kinds are coarser than his tabs (one "weapon" kind, ores and bars together), so a few
       name rules run before the kind -> tab table: [kinds the rule applies to, name pattern, tab index]. */
    { id: "geech", name: "Geech Layout", blurb: "How Geech keeps his bank: combat and magic apart, skills split into gathering and making, and a tab each for D&Ds, quests and keepsakes.",
      tabs: [["Index (sort me)", ["misc"], "Anything not placed yet"],
        ["Combat", ["weapon", "armour", "ammo", "slayer", "prayer", "food", "summoning"], "Melee and ranged weapons and armour, Slayer, Necromancy, bones and ashes, food, Summoning"],
        ["Magic", ["runes", "teleport", "potion", "jewellery"], "Runes, runecrafting items, teleports, jewellery, potions, magic armour and weapons"],
        ["Gathering Skills", ["metal", "wood", "seeds", "archaeology", "divination", "tools", "outfit"], "Mining, Woodcutting, Farming, Archaeology, Hunter, Fishing, Divination"],
        ["Crafting Skills", ["gems", "hides", "herblore", "invention"], "Crafting, Fletching, Construction, Smithing, Cooking, Herblore, Invention"],
        ["D&D, Minigames, Tokens", ["clue", "currency", "keys"], "Clues, D&D and minigame rewards, tokens, keys, lamps and stars"],
        ["Quest Items", ["quest"], "Quest items"],
        ["Keepsakes, Cosmetics, and Seasonal", ["holiday", "keepsake"], "Seasonal, discontinued and cosmetic items, and quest rewards that cannot be reclaimed"]],
      rules: [
        [null, /deathwarden|deathdealer|death guard|skull lantern|soulbound lantern|necromancer|omni guard|deathstorm|\bmemento$/i, 1],
        [null, /^pot of flour$|^bucket of milk$|^egg$|\bspices?$|^cinnamon$|\bdye$|limestone|marble block|\bbrick$/i, 4],
        [["misc", "tools"], /fishing|\brod$|\bbait$|vine worm|^roe$|fish offcuts/i, 3],
        [["weapon", "armour"], /\bstaff\b|battlestaff|\bwand\b|\borb$|grimoire|\bmystic\b|wizard|\brobe|subjugation|ahrim|virtus|seismic|tectonic|ganodermic|grifolic|fungal|infinity|\blunar\b|batwing|spider silk|polypore|cryptbloom|splitbark|skeletal|dagon'?hai|celestial|sea singer|hailfire|sceptre|obliteration|inquisitor|praesul|imperium core|cywir|kodai|\bmage\b|\bmagic\b|elemental|avernic|wicked/i, 2],
        [["outfit"], /runecraft|ethereal/i, 2],
        [["food"], /^raw |\buncooked\b|\bdough\b|pot of flour|\bflour\b|bucket of milk|\begg$|chocolate (bar|dust)|\bspices?\b|cooking apple|\bgrapes\b/i, 4],
        [["metal"], /\bbar$|\bingot\b|\bnails$|salvage|burial|\bgold leaf\b|protean bar/i, 4],
        [["wood"], /\bplanks?$|\bshafts?$|\(u\)$|bow ?string|\bflax\b|headless arrow|feathers?$|\bstock$|refined/i, 4],
        [["tools"], /\bhammer$|\bchisel$|\bknife$|\bsaw$|\bneedle$|\bmould$|\bshears$|pestle and mortar|\bpot$|\bbowl$|\bjug$|crystal (saw|chisel|hammer|knife)|\bbucket/i, 4],
        [["outfit"], /blacksmith|artisan|sous chef|constructor|factory|\bchef/i, 4]
      ] }
  ];
  function template(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return TEMPLATES[0]; }
  /* -> {index (0-based), number (as the game counts tabs, 1 = the first tab), name} */
  function tabFor(kind, templateId, name) {
    var t = template(templateId), i;
    if (t.rules && name) for (i = 0; i < t.rules.length; i++) if ((!t.rules[i][0] || t.rules[i][0].indexOf(kind) >= 0) && t.rules[i][1].test(name)) return { index: t.rules[i][2], number: t.rules[i][2] + 1, name: t.tabs[t.rules[i][2]][0] };
    for (i = 0; i < t.tabs.length; i++) if (t.tabs[i][1].indexOf(kind) >= 0) return { index: i, number: i + 1, name: t.tabs[i][0] };
    return { index: 0, number: 1, name: t.tabs[0][0] };
  }

  /* gear that is upgraded rather than replaced: never "below your tier" */
  var UPGRADEABLE = /deathwarden|deathdealer|death guard|skull lantern|first necromancer|masterwork|\(tier \d+\)|\+ ?\d$/i;
  function upgradeable(name) { return UPGRADEABLE.test(String(name || "")); }

  return { upgradeable: upgradeable, kindOf: kindOf, tabFor: tabFor, template: template, TEMPLATES: TEMPLATES, KIND_LABEL: KIND_LABEL, SUPPLY: SUPPLY, TRAINS: TRAINS, RULES: RULES };
});
