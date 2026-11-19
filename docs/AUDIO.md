# Audio

Star Dominion's sound has three parts: generative music, sampled sound effects and mixed ambience.

- **Music** is composed live in the browser by `src/audio/music.ts`. Nothing in it is sampled from existing recordings.
- **Sound effects** are Kenney's CC0 packs, processed by `scripts/build_audio.py`.
- **Ambience** mixes synthesised layers with Kenney CC0 loops.

Audio is optional: with no Web Audio, with sound muted or with every file missing, the game plays normally.

## How it works

- **Autoplay.** No audio context exists until the first pointer, key or touch gesture (`installAudioUnlock`). After that, music starts in the current context.
- **Buses.** There are master, music, effects and ambience buses, behind a soft limiter.
  - Volume sliders use a squared curve, and changes apply immediately.
  - Effects play a preview tone as you drag their slider (the master slider too). Music and ambience are already playing, so you hear those changes directly.
- **Mute.** The M key, the speaker button in the ministries column and on the title screen, and the Sound settings all mute. A muted or silent mix suspends the context, so no audio work is done.
- **Throttling.** Each sound has a minimum gap and a voice limit, and the whole mix is capped at 24 voices. A burst of game events plays only its most important sound.
- **No duplicates.** There is a single `AudioManager` and a single director. A music context switch fades the old section while the new one rises, and at most one section is live. There is one ambience bed at a time.
- **Formats.** Ogg Vorbis is used, with AAC (`.m4a`) for browsers that cannot play Ogg.
- **Missing files.** A missing file is decoded once, warned about once in the console and then skipped.

## Music contexts

| Context | When | Character |
|---|---|---|
| Empire entry | Title screen | D aeolian; pads, choir, sparse bells |
| Galaxy exploration | On the map | E lydian; airy pads and bells |
| Empire management | Management windows | F major; gentle pads, bells, light pluck |
| Capital development | Capital window | C mixolydian; ostinato plucks and low drums |
| Political tension | Diplomacy, council, intelligence, throne | C# dorian; dark pads, choir, slow pulse |
| War | While the realm is at war | A harmonic minor; brass, drums, driving pluck |
| Megastructure construction | Construction or Systems window while a megastructure is building | D lydian; broad pads and choir |
| Late-game civilisation | Era 4 and beyond | B lydian; choir and bells |

- Switches into or out of war and the title screen happen at once. Other switches wait 5 seconds, so that flicking between windows does not churn the music.
- Stingers mark a new era, a declared war, victory, defeat and a fully completed megastructure.

## Sound events

| Category | Trigger |
|---|---|
| Interface | Hover and clicks on buttons, selecting a system, opening and closing windows, toggles, confirmations, errors (a refused command) |
| Notifications | Realm events, graded by severity |
| Resource transactions | Market trades, trade events |
| Construction | Queuing buildings, ships, capital works, stations and upgrades; completed colonies, outposts and starbases |
| Research | A technology is completed |
| Recruitment and characters | Recruiting, posts, skills, equipment, heirs, captives, covert operations |
| Fleets | Move, patrol, merge and split orders; stance changes |
| Combat | Battles involving the realm (distant boom, lasers, explosions); invasions and captures |
| Diplomacy | Proposals, contracts and peace offers sent; treaties signed or answered |
| Megastructures | Each completed stage; a stinger when one is fully operational |
| Milestones | Era stinger, victory and defeat stingers |

## Ambience

| Scene | When | Layers |
|---|---|---|
| Space | Galaxy map | Synthesised drone and deep noise, rare distant pings |
| Orbit | Inside a system | Swept band-passed "solar wind", drone, faint machinery (Kenney) |
| City | Capital window | Industrial hum and machinery (Kenney loops), random metal impacts (Kenney), low drone |
| Fleet | Fleets, military and war-room windows | Ship engines (Kenney loop), drone |

## Asset sourcing and licences

1. **Existing project audio:** there was none before this milestone.
2. **Original procedural audio:** all of the music and the synthesised ambience layers.
3. **Free assets with verified licences:** two Kenney packs, both CC0 1.0. Each pack's `License.txt` was checked after download.
   - [Interface Sounds](https://opengameart.org/content/interface-sounds)
   - [Sci-fi Sounds](https://opengameart.org/content/sci-fi-sounds)

The packs were fetched from Kenney's own OpenGameArt pages, because kenney.nl is blocked by this environment's proxy. They are listed in `scripts/candidate-sources.json`.

The build script trims, normalises, makes seamless loops and encodes the files. It writes `src/audio/manifest.json`, which names every sound's source file, pack, author and licence. There are 30 sounds and 0.74 MB of files.

No commercial or extracted game audio is used. No paid assets or services are used.

| Sound id | Source file(s) | Pack | Kind |
|---|---|---|---|
| `ui.hover` | tick_002.ogg | Interface Sounds | one-shot |
| `ui.click` | click_002.ogg, click_003.ogg | Interface Sounds | one-shot |
| `ui.select` | select_002.ogg | Interface Sounds | one-shot |
| `ui.open` | maximize_008.ogg | Interface Sounds | one-shot |
| `ui.close` | minimize_008.ogg | Interface Sounds | one-shot |
| `ui.toggle` | toggle_002.ogg | Interface Sounds | one-shot |
| `ui.confirm` | confirmation_001.ogg | Interface Sounds | one-shot |
| `ui.error` | error_004.ogg | Interface Sounds | one-shot |
| `notify.info` | bong_001.ogg | Interface Sounds | one-shot |
| `notify.good` | confirmation_002.ogg | Interface Sounds | one-shot |
| `notify.warn` | question_003.ogg | Interface Sounds | one-shot |
| `notify.danger` | error_005.ogg | Interface Sounds | one-shot |
| `res.trade` | drop_002.ogg | Interface Sounds | one-shot |
| `diplomacy` | pluck_002.ogg | Interface Sounds | one-shot |
| `treaty` | confirmation_004.ogg | Interface Sounds | one-shot |
| `character` | select_005.ogg | Interface Sounds | one-shot |
| `build.start` | doorClose_001.ogg | Sci-fi Sounds | one-shot |
| `build.done` | forceField_001.ogg | Sci-fi Sounds | one-shot |
| `research.done` | forceField_003.ogg | Sci-fi Sounds | one-shot |
| `recruit` | doorOpen_001.ogg | Sci-fi Sounds | one-shot |
| `fleet.order` | thrusterFire_002.ogg | Sci-fi Sounds | one-shot |
| `combat.laser` | laserLarge_000.ogg, laserLarge_002.ogg | Sci-fi Sounds | one-shot |
| `combat.explosion` | explosionCrunch_001.ogg, explosionCrunch_003.ogg | Sci-fi Sounds | one-shot |
| `combat.distant` | lowFrequency_explosion_001.ogg | Sci-fi Sounds | one-shot |
| `combat.impact` | impactMetal_002.ogg | Sci-fi Sounds | one-shot |
| `mega.stage` | lowFrequency_explosion_000.ogg | Sci-fi Sounds | one-shot |
| `amb.fleet` | spaceEngineLow_001.ogg | Sci-fi Sounds | loop |
| `amb.industry` | spaceEngineLarge_002.ogg | Sci-fi Sounds | loop |
| `amb.machines` | computerNoise_001.ogg | Sci-fi Sounds | loop |
| `amb.metal` | impactMetal_000.ogg, impactMetal_003.ogg | Sci-fi Sounds | one-shot |
