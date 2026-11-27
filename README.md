# Pocket Pals v2

A local-first rebuild. Plain HTML, CSS and JS, with no build step and nothing to install.

## Preview
- **Double-click `start.command`.** It starts a small local server and opens the game and the admin
  dashboard side by side. Changes you make in the admin show up in the open game straight away.
- You can also open `index.html` and `admin.html` directly. In Chrome that works too, but other browsers
  may keep the two pages' data apart, so use `start.command` if the admin doesn't affect the game.

All data is stored in the browser's `localStorage`. Data saved under `localhost` is separate from data
saved from `file://`, so stick to one way of opening it. Use **Admin → Data & backup → Export** to keep a copy.

## Files
| File | What it does |
|---|---|
| `js/schema.js` | **The source of truth.** Every setting, every kind of content (needs, items, care actions, areas, quests), the player-save fields and the activity-log kinds. |
| `js/store.js` | Loads, validates and saves game data, the player save and the activity log. Keeps the tabs in sync. |
| `js/game.js` + `index.html` + `css/game.css` | The game screen. |
| `js/admin.js` + `admin.html` + `css/admin.css` | The admin dashboard. Its settings forms and content editors are built from the schema. |
| `js/icons.js` | Line icons used by both. |
| `css/base.css` | Shared design tokens (light and dark). |

## Online (Google sign-in, Firebase)
Off until `js/online/firebase-config.js` has your Firebase config; until then everything stays in the browser.
When it's on, the game and the admin ask for Google sign-in, and only emails on the allowlist
(**Admin → Online**) get in. Saves and the game data live in Firestore and sync between devices; in-game
names are unique across all players. Layout and permissions are in `js/online/cloud.js` and `firestore.rules`.

Setup (once):
1. **console.firebase.google.com** → create a project (free Spark plan).
2. **Authentication → Sign-in method → Google**: enable. **Firestore Database**: create.
3. **Firestore → Rules**: paste `firestore.rules`, replace `OWNER_EMAIL` with your Google email, publish.
4. **Project settings → Your apps → Web (</>)**: register an app and paste its config into `js/online/firebase-config.js`.
5. **Hosting**: pushes to `main` deploy through `.github/workflows/firebase-hosting.yml`. On GitHub add the secret
   `FIREBASE_SERVICE_ACCOUNT` (Project settings → Service accounts → Generate new private key, paste the whole JSON)
   and the variable `FIREBASE_PROJECT_ID`.
6. Add your Firebase Hosting domain in **Authentication → Settings → Authorized domains** if it isn't there.

Keep the GitHub repository **private**: the game uses Pokémon names and art.

### Friends (online)
Players sign in with Google and choose a unique player name; friends find each other by that name in the
**Friends** tab (requests, accept/decline). Friends show a green dot when online (seen in the last 3 minutes)
and a grey dot when not, and can chat, trade Pokémon (the offered Pokémon is held by the trade until it is
accepted, declined or taken back) and fight **live turn-based battles**: both players' screens run each turn
with the same shared random numbers, so they always show the same battle; a player who stops answering for
2 minutes loses. Friend battles never change your Pokémon. Code: `js/online/social.js` (data) and the Friends
section of `js/game.js` (screens); permissions in `firestore.rules`. **Admin → Online** lists who joined
recently (with their Google email, visible only to admins) and who is online.

## The rule: everything is adjustable from the admin
1. **Describe it in `schema.js` first.** A new number goes in `settings`. A new kind of thing goes in
   `collections`, with its fields and default rows. Admin pages for it appear automatically.
2. **Gameplay code only reads values from `data`.** No hardcoded tuning numbers in `game.js`.
3. **Anything the game generates or changes calls `S.log(kind, text)`**, so it appears in **Admin → Activity**.
4. **Anything stored on the player goes in the save** (`store.js` → `newSave` / `normalizeSave`) and gets a
   control on **Admin → Player**.

## Admin dashboard
- **Overview**: live player stats, needs, quick adjustments (+coins, +gems, fill needs, level up, clear cooldowns, fast time).
- **Player**: edit the save directly (profile, needs, bag, quest progress) or start a new player.
- **Activity**: every action, explore, purchase, quest claim, level up and admin edit, with filters and export.
- **Game settings**: levels, currencies, time and needs, exploring, interface (tab names, banner, on/off switches), system.
- **Content**: add, edit, duplicate, reorder and delete needs, items, care actions, areas and quests.
- **Data & backup**: export, import and reset.

## Regions, areas and encounters
- The game is organised by **region** (Content → Regions). The first region is **Lumera**, an original region;
  its outline (cast, 16 chapters, places) is in `docs/region-outline.md`.
- **Areas** (Content → Areas) have a region, environment, unlock requirements (trainer level, areas visited first,
  items owned), rewards and a wild-Pokémon chance. Locked areas show exactly what is still needed.
- **Encounter tables** list which Pokémon appear in an area for each method (walking, cave, surf, rods, static,
  special, legendary); **Encounter entries** give each Pokémon's share and levels. Exploring rolls twice: first
  whether a wild Pokémon appears (the area's chance), then which one (weighted by share). All tables are custom
  game-design data, not official spawn data.
- **System → Content check** finds tables that don't add up to 100%, missing Pokémon or areas, legendaries in
  ordinary tables, circular requirements and areas that can never be unlocked.
- Engines (no UI) live in `js/engine/`: `progression.js`, `encounters.js`, `validate.js`.
- Trainer level and Pokémon levels are separate. Each Pokémon levels at its species' growth speed; species facts
  (types, base stats, catch rate, growth) come from `tools/pokeapi/` via `python3 tools/build_pokemon.py`.

## Story journey
- **Explore** has two tabs. **Story**: the current chapter's checklist and a button for the next step (scenes,
  set wild encounters, trainers you must beat, arriving somewhere new, resting, Gym Leaders and badges).
  **Wild battles**: every area the story has opened, with **Wild battle** (always finds a Pokémon from that area)
  and **Search** (items, sometimes a Pokémon).
- Areas open when the story reaches them (Content → Areas → "Opens at story step"), so new routes bring new
  Pokémon to catch. Losing a battle sends you back to the last town, healed; you can try again.
- Content lives in `js/content-lumera.js` (default rows) and is edited in the admin: **Chapters**, **Badges**,
  **Trainers** (team as `species:level, …`; `counter:7` = the starter strong against yours) and **Story steps**
  (in order; text lines can start with `Name:` to show who speaks). A trainer with **Player always wins** (on for the first rival battle) heals the team first and keeps the player’s Pokémon at 1 HP or more. Admin → Player has a **Story** panel to move a
  player to any step and give badges. The Content check validates trainers, steps and story unlocks.

## Quests
- The quest card on the home screen (and the gem pill) opens **Quests**, with four tabs: **Story**, **Daily**,
  **Exploration** and **Achievements**. A red number on a tab means a reward is ready to claim. The home card shows
  a quest ready to claim first.
- **Content → Quests**: each quest has a kind, a goal, how many, and rewards (coins, gems, EXP and an item).
  Goals marked *total* count what the player already has (level, Pokédex caught/seen, badges, trainers beaten,
  chapters, Pokémon owned, a specific chapter or badge); the others count new actions from when the quest is on offer.
- **Daily** quests start over every day. **Game settings → Time & needs** sets the reset hour and how many daily quests
  are picked each day (0 = all). **Admin → Player** shows each quest's progress and has a **New day** button.

## Walking explore
Exploring an area (Explore → Wild battles) sends your partner walking left to right across the area's wide path
picture. Along the way a few places (Game settings → Exploring: *Places a wild Pokémon can appear*) each roll the
area's wild-Pokémon chance; on a hit a "!" pops up, the screen flashes and a wild battle starts, then the walk carries
on. Reaching the end finishes the explore and gives the area's rewards. Path pictures are 3:1 images in
`assets/backgrounds/path-*.jpg`; each area picks one (Content → Areas → *Explore path picture*) or uses the one for its
environment. Walk speed, stops and the most battles per walk are under Game settings → Exploring.

## Battles
- `js/battle.js` is the battle screen and rules, used by the game and by `battle-preview.html` (a sandbox with a
  sample team that never touches your save).
- Exploring an area can start a **wild battle**: fight (4 moves), bag (Poké Balls, medicine), switch, run. Caught
  Pokémon go to the team (if there's room) or the PC box, and into the Pokédex. Losing sends you back to the last
  town with your team healed. A battle in progress resumes after a refresh.
- Team (up to 6) is managed in the Pokemon tab's PC box. HP carries over between battles, recovers slowly over
  time, and towns have a free "Heal team".
- **Admin → Game settings → Battles**: team size, EXP and catch multipliers, run chance, HP recovery, starter kit,
  and the battle backgrounds for land, forests, caves, water, hideouts and Gym Leaders (any area can pick its own).
- **Content → Moves** (107 moves); each Pokémon's **Moves learned** (`level:move,…`). The default move sets are
  custom game-design lists generated by `tools/build_pokemon.py` from each Pokémon's types and stats.

## Welcome, names and tutorial
New players are greeted by the Professor, choose an in-game name, pick a starter and get a guided tour. The
Professor's lines, name rules and reserved names are in **Admin → Game settings → Welcome & tutorial**, and the
tour steps are in **Content → Tutorial**. Names are unique *on this device* (taken names are listed, and can be
released, in **Data & backup**). Names that are unique across different players need online accounts.

## Pokémon
`js/catalog-pokemon.js` (sprite index plus the default Pokémon list) is generated from `assets/Pokemon Sprites/`
(PMD SpriteCollab layout) by `python3 tools/build_pokemon.py`. Run it again after adding sprite folders. New
players choose a starter (every Pokémon marked **Starter** in **Admin → Content → Pokémon**). Starter screen
text, size, walking and standing height are under **Admin → Game settings → Pokémon**, and each care action's
animation is under **Content → Care actions**.

## Shop items
`js/catalog-items.js` is generated from the icon folders in `assets/Pokemon Items/` (Evolutionary, Hold Item,
Recovery, Vitamins) by `python3 tools/build_item_catalog.py`. Edit names, prices, currency and categories in
**Admin → Content → Items** and **Shop categories**. If you rebuild the catalogue with new items, raise
`contentVersion` in `schema.js` so existing saved data picks them up.

