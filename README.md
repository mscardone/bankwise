# Bankwise

An [Alt1 Toolkit](https://runeapps.org/alt1) app for RuneScape 3 that reads your bank and tells you, for every item on screen:

- **what it is worth** (RuneScape Wiki Grand Exchange price, as a colour tier on the item and the exact figure in the app),
- **which tab it belongs in**, from a layout template you pick,
- **whether to keep, sell or destroy it** - junk, reclaimable from Diango, quest item, training supply - with the reason spelled out.

It only reads the screen and draws markers. It never clicks, types or moves anything in the game.

> **Status: v0.8.1.** Bank reading, item matching and tooltip reading are tested on real Alt1
> captures (items match pixel-for-pixel between captures). The wiki lookups and the RuneMetrics
> lookup have not worked live yet. See "Not proven yet" below.

## Install

Paste into Alt1's browser address bar:

    alt1://addapp/https://projects.scottcardone.com/bankwise/appconfig.json

Local development: run `serve.cmd`, then `alt1://addapp/http://localhost:8232/appconfig.json`.

The app needs the **pixel**, **overlay** and **game state** permissions (game state is how it knows where your mouse is).

## Using it

0. Nothing to set up: the app ships with a starter library of learned items (`data/seed-library.json`) and the RuneScape Wiki's icon for nearly every item (`data/wiki-icons.json` + `.png`, fetched once and then kept on your computer). An item recognised from a wiki icon is treated like any known item; hovering it in the bank settles or corrects it.
1. Open your bank. Items the app does not know and cannot recognise get a red box.
2. Sweep your mouse across the items. When the game shows an item's name, Bankwise reads it and remembers what that item looks like - permanently. A few minutes covers a whole bank, and each item only ever needs doing once.
3. Known items lose their box and get:
   - a coloured bar along the top for what **one** of the item is worth: green 1k+, teal 10k+, blue 100k+, purple 1m+, gold 10m+;
   - the value of the whole stack in gold under the item (`950`, `12.3K`, `1.23M`, `2.5B`; the app reads the stack number);
   - a letter in the top right corner when there is advice: **J** junk (sell or alch), **D** reclaimable from Diango (safe to destroy), **Q** quest item for a finished quest, **K** quest item to keep.
4. Hover an item in the bank, or a row in the app, for the detail card: price, stack value, high alch value, the tab it belongs in and the reason for the verdict. The card follows the mouse whether or not teach is on.
5. The **teach** tick-box in the header switches learning from tooltips on and off. *Type the name yourself* on the card fixes a misread.
6. A small amber corner means the item shares its exact icon with other items (a ring and its enchanted version, a necklace at different charges): the app shows whichever one you hovered last and lists the rest on the card.
7. An amber box means "looks like X, not sure" - hover it once to settle it. If a name was read wrongly, use *wrong name?* on the card.

### Settings

- **Bank layout** - five templates (five-tab essentials, PvM-focused, skiller, granular 14-tab, and the author's own eight-tab Geech Layout). The tab numbers on screen follow the template.
- **Advice** - out of the box only wiki data is used, so advice is the same for everyone. Three options, all off by default, make it personal:
  - *my quest log* - a quest item whose quest you have finished can go;
  - *my skill levels* with a goal level - logs are a keeper at 80 Firemaking and sellable at 99;
  - *my own pins* - mark any item always-keep or always-junk.
- **RuneMetrics** - type your name and press *Look up* to fetch skills and quests (your profile must be public). If the lookup is blocked, the panel shows the two addresses to open and a box to paste the result into.
- **Overlay** - every part of the overlay has its own tick-box: the colour bars (with your own hex colours and gp cutoffs), the stack value (own colour, optional minimum total, single items or not), each advice letter (J, D, Q, K, and an optional ? for "check before destroying"), and each kind of box. *Overlay back to defaults* undoes it all.
- **Item library** - export / import / forget. An exported library can be given to someone else so they start with your items already known.

## How it works

- `src/reader.js` finds the bank by its flat background colour, splits it from neighbouring panels at solid walls, and fits the slot lattice from the periodic columns of items - so it works at any interface scale and any bank-window size, in a single tab or the all-tabs view with its "Tab N" dividers. Each slot is cut below the stack number and area-averaged to a 24x16 patch.
- `src/library.js` stores learned patches (about 1.5 KB per item, in localStorage) and matches a slot by its **worst** 3x3 block, tried at small pixel offsets. Worst-block matters: two potions differ only in the colour of a small blob of liquid, which an average would wash out.
- `src/data.js` fetches prices, high-alch values and shop values once a day from the wiki's own tables (`Module:GEPrices/data.json`, `GEHighAlchs`, `GEValues`, read through the wiki API), falling back to the Grand Exchange dump and then to item-by-item lookups, and each item's wiki categories the first time it is seen. `src/kinds.js` turns name + categories into one of 28 kinds and maps kinds to tabs. `src/verdict.js` is the keep/sell/destroy rule list. `src/runemetrics.js` is the optional profile lookup.
- `src/tooltip.js` finds the game's tooltip (since the 2026 interface it is a very dark brown box, not the pure black one Alt1's stock finder looks for), climbs to its top panel and reads the item name, which the game draws in its own colour, with Alt1's chat fonts (12-18pt tried; 14pt is the one at default scale).
- `src/reader.js` also keeps the slot lattice steady between reads: a tooltip hides whole rows and nudges the fit by a pixel, so rows and columns are carried over from the previous read while most of them still line up.
- `src/wikilib.js` guesses unknown items from the RuneScape Wiki's icons. Those are trimmed and not pixel-identical to the game's, so both sides are anchored on their own content (bottom edge, middle of the bottom 12 rows) and compared by average colour difference; rows under the stack number are ignored. `src/wikibuild.js` builds that icon library in the player's browser from a wiki category, keeps it in IndexedDB, and can export `data/wiki-icons.json` + `wiki-icons.png` to ship with the app (every icon as an 18x12 tile on one PNG sheet, a third of the size of the raw bytes and byte-exact off a canvas; `tools/pack-icons.js` makes the same sheet from an older `.bin`). A tooltip name is refused when the wiki is sure the slot is a different item.
- `src/stack.js` reads the stack size: an 8px pixel font at a fixed place in the slot, matched column by column; yellow = the number, white = thousands, green = millions (so white/green stack values are approximate).
- `vendor/` holds the official Alt1 libraries (`a1lib`, `ocr`, four chat fonts) from the `alt1` npm package, unmodified. No build step.

## Not proven yet

1. **Other interface scales and long item names.** Tested at the default scale only; a name that wraps onto a second tooltip line is read as its first line.
2. **Different items that share one icon** (three in the test bank) can never be told apart by looks: they stay amber and the card says "X or Y".
3. **Wiki answers.** The names of the wiki's price tables (new in 0.7.0, not yet seen answering from inside Alt1; *reader debug -> Test the wiki data sources* shows what came back), the price file's field names and the category names the rules look for (`Reclaimable from Diango`, `Quest items`, a category named after the quest) are from memory of the wiki, not from a checked response. The debug panel shows what each source last said.
4. **RuneMetrics from inside Alt1** - may be blocked cross-origin; JSONP and paste are the fallbacks.

Not built yet: stack sizes at interface scales other than 100%, placeholders, and a whole-bank report.

## Updating the shipped data

- **Starter library**: Settings -> Item library -> Export, save the file as `data/seed-library.json`.
- **Wiki icons**: after a rebuild, Settings -> Wiki icons -> *Download wiki-icons.json* and *Download wiki-icons.png*, both into `data/` (they must come from the same build).

## Development

    npm install        # pngjs, for the tests
    npm test           # reader + library checks on the test images
    node test/ui.js    # whole app in headless Chromium with a fake Alt1 (needs playwright)

Alt1 caches scripts: bump `VERSION` in `src/app.js` and every `?v=` in `index.html` together on each release.

Item prices and item data come from the [RuneScape Wiki](https://runescape.wiki) (CC BY-NC-SA 3.0).
