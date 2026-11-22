# Star Dominion 1.0.0: release notes

The first complete release. [CHANGELOG.md](../CHANGELOG.md) lists what is in the game. This page covers how the release was checked, what was fixed, how it performs, and what is still known to be limited.

## Bug audit

Each kind of check has its own script, so it can be run again before every release.

### Command fuzzing (`npm run fuzz`, `tests/fuzz.test.ts`)

A stand-in player issues 25 random commands every month while the simulation runs. The commands cover every command type: building, fleets, research, diplomacy, characters, the council, the capital and the vault.

- Most targets are drawn from the live game (your worlds, your fleets, known characters). About one in ten is deliberately invalid: a negative or unknown id.
- Every command must either succeed or be refused with a message. Nothing may throw.
- After each month of play, about 40 invariants are checked:
  - stocks and statistics are finite;
  - nothing is owned by a fallen realm;
  - queues, stability, supply and loyalty stay in range;
  - fleets and admirals are consistent;
  - no ship is in two fleets;
  - wars have two live sides;
  - no treaty links a realm to itself, to a fallen realm, or to an enemy at war with it;
  - no offer is addressed to a fallen realm.
- Every five game years, the save is written and read back. The reloaded game must be identical.

**Scale:** small and medium galaxies, all three difficulties, 20 years each, on 6 seeds. That is 36 reigns, up to 216,000 random commands and 8,640 monthly checks (fewer where the stand-in player was conquered first). A 4-year version runs in the unit tests on every push.

**What it found:**

| Problem | How often | Cause | Fix |
|---|---|---|---|
| Crash when a fleet was ordered to a star that doesn't exist | 84 times (moves and patrols) | The route finder read the target star without checking it | Routes to unknown stars are refused ("No route"), and patrol points are checked |
| Treaty partners at war with each other | 446 monthly checks | (1) When a war started, an ally of the attacker joined it even if it was also allied to, or a vassal of, the defender. (2) A peace that made the loser a vassal left the two realms still fighting each other in another war | Realms bound to the other side stay out; joining a war is refused against your own overlord or vassal; a new vassal leaves its other wars with its overlord (a war left with one side empty ends, with a truce) |
| A realm in a treaty with itself | 1,266 monthly checks | Offers addressed to oneself were accepted | Refused at the command, and treaties with oneself cannot be signed |
| Offers left addressed to a fallen realm | 3 | Fallen realms were not cleaned out of open offers | A monthly consistency pass removes them, along with any treaty that slips through the rules above |

The audit after the fixes is reported under [Checks run for this release](#checks-run-for-this-release).

### Browser audit (`npm run fuzz:browser`)

This test drives a real reign in Chromium at desktop size (1440×900) and phone size (390×844, touch):

- It opens every one of the 24 screens and presses 20 random buttons, tabs, list rows and drop-downs on each.
- It then fast-forwards two years, saves and loads the game back, and repeats.
- It records every page error, console error, blank screen and crash message, and any click that drops the player out of the reign.

The results are reported under [Checks run for this release](#checks-run-for-this-release).

### Code review and hands-on checks

| Problem | Fix |
|---|---|
| Autosave stopped after loading an earlier save, until the game passed the latest date reached before (up to many game years without an autosave) | Autosave counts from the loaded date |
| Camera keys (W A S D Q E) stayed held after switching windows mid-press, so the map kept drifting | Held keys are released on blur and when a modifier key is pressed |
| Game shortcuts caught browser shortcuts (Ctrl+1 switched the game speed as well as the tab) and fired inside text areas | Shortcuts ignore modifier keys, text areas and editable text |
| Space on a focused button pressed the button and paused the game | Space only pauses |
| Exporting a save could cancel the download in some browsers | The download link is released after the download starts |
| Importing the same file twice did nothing; a wrong file gave a bare error | The picker resets; the message explains what to choose |
| On phones the mute button covered the title on the title screen | Moved to the corner, with room left above the title |
| A failure inside any one screen blanked the whole game | Every window, and the capital view, is contained by an error boundary; the interface as a whole offers a rescue save |

## Performance and capabilities

- **Startup.** three.js and React are in their own files, so a game update doesn't download them again. The capital city's renderer and models load the first time the capital opens, or in idle time once a reign is running. A loading screen shows while the game starts.

  | File | Size (gzip) |
  |---|---|
  | three.js | 197 KB |
  | React | 47 KB |
  | Game | 272 KB |
  | Capital city | 38 KB |

  Before this release, everything was a single 556 KB (gzip) file.
- **Offline and install.** A service worker caches the game after the first visit:
  - the page is fetched network-first, so new releases arrive;
  - built files, models, textures and sounds are cache-first.

  Tested with the production build in Chromium: after one online visit, the game reloads and starts a reign with the network switched off. The web app manifest and icons let the game be installed from the browser on desktop and phone.
- **Rendering.** Existing measures were kept:
  - the map redraws only as often as needed (full rate while you handle it, slower when idle, never in a hidden tab);
  - quality tiers are chosen for the device;
  - the full-screen capital stops the map drawing underneath.

  New: in Auto quality, if the map's frame rate drops below about 33 per second while you handle it, it renders at a lower resolution (down to 60% of the screen's pixels) and raises it again when there is headroom.
- **Simulation.** Unchanged and deterministic. The 10,000-system speed test passes when run alone; it is sensitive to other load on the machine (see [Known limits](#known-limits)).

## Checks run for this release

Filled in from the final runs; see the pull request for the raw output.

## Known limits

- **Real GPUs.** The automated browser tests use SwiftShader, which renders WebGL in software. They show that the game works, not how fast it runs on real graphics hardware. Frame rates on real devices have not been measured.
- **Safari and iOS.** These are not covered by the automated tests; the phone layout is tested in Chromium at iPhone size.
- **Balance.**
  - Ascension is the most common way to win.
  - Relaxed and standard difficulty are close in how often the player wins.
  - Large galaxies (120 systems) and the Milky Way have not been balance-tested.

  See [CAMPAIGN.md](CAMPAIGN.md).
- **The 10,000-system speed test** checks wall-clock time and can fail when the machine is busy with other work.
- **No full human playthrough to victory** has been recorded. Play-testing used a scripted beginner stand-in (`scripts/human-proxy.ts`) and the audits above.
