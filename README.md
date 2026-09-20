# Bankwise

An [Alt1 Toolkit](https://runeapps.org/alt1) app for RuneScape 3 that reads your bank and tells you, for every item on screen:

- **what it is worth** (RuneScape Wiki Grand Exchange price, as a colour tier on the item and the exact figure in the app),
- **which tab it belongs in**, from a layout template you pick,
- **whether to keep, sell or destroy it** - junk, reclaimable from Diango, quest item, training supply - with the reason spelled out.

It only reads the screen and draws markers. It never clicks, types or moves anything in the game.

> **Status: v0.2.0.** Bank reading, item matching and tooltip reading are tested on real Alt1
> captures (items match pixel-for-pixel between captures). The wiki lookups and the RuneMetrics
> lookup have not worked live yet. See "Not proven yet" below.

## Install

Paste into Alt1's browser address bar:

    alt1://addapp/https://projects.scottcardone.com/bankwise/appconfig.json

Local development: run `serve.cmd`, then `alt1://addapp/http://localhost:8232/appconfig.json`.

The app needs the **pixel**, **overlay** and **game state** permissions (game state is how it knows where your mouse is).

## Using it

1. Open your bank. Every item gets a red box: the app does not know any items yet.
2. Sweep your mouse across the items. When the game shows an item's name, Bankwise reads it and remembers what that item looks like - permanently. A few minutes covers a whole bank, and each item only ever needs doing once.
3. Known items lose their box and get:
   - a coloured bar for value: green 1k+, teal 10k+, blue 100k+, purple 1m+, gold 10m+ (per item, not per stack);
   - a letter when there is advice: **J** junk (sell or alch), **D** reclaimable from Diango (safe to destroy), **Q** quest item for a finished quest, **K** quest item to keep.
4. Hover an item in the bank, or a row in the app, for the detail card: price, alch value, the tab it belongs in and the reason for the verdict.
5. An amber box means "looks like X, not sure" - hover it once to settle it. If a name was read wrongly, use *wrong name?* on the card.

### Settings

- **Bank layout** - four templates (five-tab essentials, PvM-focused, skiller, granular 14-tab). The tab numbers on screen follow the template.
- **Advice** - out of the box only wiki data is used, so advice is the same for everyone. Three options, all off by default, make it personal:
  - *my quest log* - a quest item whose quest you have finished can go;
  - *my skill levels* with a goal level - logs are a keeper at 80 Firemaking and sellable at 99;
  - *my own pins* - mark any item always-keep or always-junk.
- **RuneMetrics** - type your name and press *Look up* to fetch skills and quests (your profile must be public). If the lookup is blocked, the panel shows the two addresses to open and a box to paste the result into.
- **Item library** - export / import / forget. An exported library can be given to someone else so they start with your items already known.

## How it works

- `src/reader.js` finds the bank by its flat background colour, splits it from neighbouring panels at solid walls, and fits the slot lattice from the periodic columns of items - so it works at any interface scale and any bank-window size, in a single tab or the all-tabs view with its "Tab N" dividers. Each slot is cut below the stack number and area-averaged to a 24x16 patch.
- `src/library.js` stores learned patches (about 1.5 KB per item, in localStorage) and matches a slot by its **worst** 3x3 block, tried at small pixel offsets. Worst-block matters: two potions differ only in the colour of a small blob of liquid, which an average would wash out.
- `src/data.js` fetches the wiki's Grand Exchange dump once a day and each item's wiki categories the first time it is seen. `src/kinds.js` turns name + categories into one of 28 kinds and maps kinds to tabs. `src/verdict.js` is the keep/sell/destroy rule list. `src/runemetrics.js` is the optional profile lookup.
- `src/tooltip.js` finds the game's tooltip (since the 2026 interface it is a very dark brown box, not the pure black one Alt1's stock finder looks for), climbs to its top panel and reads the item name, which the game draws in its own colour, with Alt1's chat fonts (12-18pt tried; 14pt is the one at default scale).
- `src/reader.js` also keeps the slot lattice steady between reads: a tooltip hides whole rows and nudges the fit by a pixel, so rows and columns are carried over from the previous read while most of them still line up.
- `vendor/` holds the official Alt1 libraries (`a1lib`, `ocr`, four chat fonts) from the `alt1` npm package, unmodified. No build step.

## Not proven yet

1. **Other interface scales and long item names.** Tested at the default scale only; a name that wraps onto a second tooltip line is read as its first line.
2. **Different items that share one icon** (three in the test bank) can never be told apart by looks: they stay amber and the card says "X or Y".
3. **Wiki answers.** The price file's field names and the category names the rules look for (`Reclaimable from Diango`, `Quest items`, a category named after the quest) are from memory of the wiki, not from a checked response. The debug panel shows what each source last said.
4. **RuneMetrics from inside Alt1** - may be blocked cross-origin; JSONP and paste are the fallbacks.

Not built yet: stack sizes (so values are per item, not per stack), seeding the library from wiki icons so common items need no teaching, placeholders, and a whole-bank report.

## Development

    npm install        # pngjs, for the tests
    npm test           # reader + library checks on the test images
    node test/ui.js    # whole app in headless Chromium with a fake Alt1 (needs playwright)

Alt1 caches scripts: bump `VERSION` in `src/app.js` and every `?v=` in `index.html` together on each release.

Item prices and item data come from the [RuneScape Wiki](https://runescape.wiki) (CC BY-NC-SA 3.0).
