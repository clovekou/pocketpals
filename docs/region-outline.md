# Lumera Region: outline

An original region for Pocket Pals v2. Same shape as a classic adventure (18 chapters, 8 gyms, Summit Four,
Champion, post-game), with original places and characters. Creatures are the Pokémon in `assets/Pokemon Sprites/`.
Encounter tables are **custom game-design tables**, not official data. Every place, person and number
here becomes admin-editable content.

## Cast
- **Professor Kou**: runs the lab in Hearthmoor Village and gives you your partner.
- **Kai**: your rival from the same village. Battles you at key points and becomes Champion before you.
- **Team Eclipse**: wants to control the region's rare Pokémon. Led by **Director Vex**.
- **Gym Leaders**: Fenna (Grass), Caspian (Water), Rhett (Electric), Garnet (Rock), Celeste (Psychic),
  Nyx (Poison), Ignatius (Fire), Thorne (Ground).
- **Summit Four**: Isolde (Ice), Brannoc (Fighting), Morwen (Ghost), Drakon (Dragon). **Champion**: Kai.

## Chapters
| # | Title | Places | Lv |
|---|---|---|---|
| 1 | The Beginning | Hearthmoor Village | 1 |
| 2 | First Steps | Fernway Trail, Brookhaven Town, Willowbank Path | 2 |
| 3 | The Sprout Badge | Mossglow Woods, Bloomhaven City, Bloomhaven Gym (Fenna) | 5 |
| 4 | Echoes Below | Cobble Pass, Glimmer Caverns, Cobble Pass East (first Team Eclipse sighting) | 8 |
| 5 | The Tide Badge | Marisport City, Marisport Gym (Caspian), Lighthouse Pier, Saltmarsh Route | 10 |
| 6 | The Spark Badge | Copperline Road, Volt Harbor, Skyliner Ferry, Harbor Gym (Rhett) | 15 |
| 7 | Below the Surface | Rumble Tunnel, Quarry Road, Fossil Museum | 18 |
| 8 | Into the Dark | Shadowfen Tunnel (needs Lantern), Lantern Hill Town, Whisper Tower | 20 |
| 9 | Eclipse Rising | Grandvale City, Grandvale Gym (Garnet), Eclipse Hideout, Whisper Tower (return) | 25 |
| 10 | Siege of Aurelle | Aurelle City, Prism Corp Tower, Aurelle Gym (Celeste) | 30 |
| 11 | The Wild Reserve | Canopy Bridge, Reedwater Route, Thornbury Town, Thornbury Gym (Nyx), Wildwood Reserve | 35 |
| 12 | Across the Sea | Coral Coast, Driftwater Routes, Frostveil Isles (Articuno) | 40 |
| 13 | Island of Embers | Cinder Isle, Ember Lab (fossil revival), Ashen Manor, Cinder Gym (Ignatius) | 45 |
| 14 | The Last Badge | Stormspire Station (Zapdos), Ironvale City, Ironvale Gym (Thorne) | 50 |
| 15 | The Summit Road | Gatekeeper Road, Trial Ridge, Cinder Peak (Moltres) | 55 |
| 16 | Champion of Lumera | Summit Sanctum (Summit Four, Champion Kai) | 60 |
| 17 | After the Summit | Hollow Gate, Hollow Deep (Snorlax, rival rematch) | 62 |
| 18 | The Lumera Legend | Hollow Core (final rival battle, Mewtwo, the Mew rumour) | 70 |

## Field abilities and key items (unlock places)
Trailblade (cut paths), Lantern (dark tunnels), Tidecraft (surf), Boulder Gloves (strength),
Wake Bell (wakes sleeping Pokémon blocking a road), Truth Lens (see ghosts), Ferry Pass, Prism Keycard,
Manor Key, Helix Fossil, Dome Fossil.

## In the game
All 18 chapters are playable: 43 areas with custom encounter tables, about 220 trainers (4–6 per route, cave and sea area, 2 Gym Trainers before every Gym Leader), 9 rival battles, 8 Gym Leaders, Team Eclipse
(grunts, Admin Lyra, Director Vex), the Summit Four and Champion Kai, and the legendary birds and Mewtwo as set
encounters. Content lives in `js/content-lumera.js` and is editable in the admin (Chapters, Areas, Encounter tables,
Trainers, Story steps).
