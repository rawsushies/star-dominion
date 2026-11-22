# Changelog

All notable changes to Star Dominion. Versions follow [semantic versioning](https://semver.org/): a new major version may change save files, a minor version adds features, a patch fixes bugs.

## 1.0.0: first release

The first complete release of the single-player game. This section lists everything that ships in 1.0.0, then the bugs fixed and the work done for release.

### The game

- **A galaxy to rule.** Galaxies of 30, 60 or 120 star systems, or a 3D Milky Way of 10,000. Every galaxy has hyperlanes, sectors, twelve planet types, special features and fog of war.
- **Real-time with pause.** Choose from three speeds. Important events pause the game for you, and the simulation is deterministic.
- **Economy.** There are nine resources, jobs and districts on every world, and an industry chain that turns minerals into alloys. You can trade on a market, run mining stations and operations, and manage logistics.
- **Kingdom.** Choose from six governments and set policies. You also have a royal council, decrees, great houses with their own ambitions, provinces with roles, royal succession and heirs, and a capital city you build up district by district.
- **People.** Admirals, generals, governors, scientists, diplomats and spies, each with traits, skills, equipment and loyalty. You can capture and ransom them.
- **War.** Thirteen hull classes, fleets with admirals and stances, battles shown in 3D, invasions, war score and peace terms.
- **Diplomacy.** Treaties, alliances, vassals, trade deals and demands, coalitions against a realm that grows too strong, and letters from rival rulers in their own voice.
- **Rival realms.** Four to six AI realms that play by the same rules as you. Each has a personality and an ambition (conquest, supremacy or ascension). They expand, arm, make alliances, betray each other and can win.
- **Three ways to win:**
  - Domination: hold half the galaxy for two years.
  - Supremacy: every rival has fallen or become your vassal, and you hold that for a year.
  - Ascension: climb the eras and finish the great project.
- **Eras and megastructures.** Seven eras from a feudal kingdom up the Kardashev scale, and megastructures built in stages.
- **Events and exploration.** Event chains your council must answer, anomalies found by exploring, ambitions and milestones.
- **Relic Vault.** Earn relics by playing and draw warships, heroes and supplies. Nothing costs real money.
- **For new players.** A guided first reign with a starter quest against a weak Pretender. Your Lord Admiral advises you, with recorded voice lines at key moments. Screens appear as you need them, short lessons have a "Do it for me" button, and stewards can build on your colonies for you. The Imperial Codex explains every system.
- **3D throughout.** A 3D galaxy, star systems and planets, a living capital with traffic, crowds and a metro, characters, and battles. Graphics quality adjusts to your device automatically.
- **Sound.** Music that follows the game, sound effects, ambience and voice, each with its own volume control.
- **Saves.** Autosave every year and whenever you leave the tab. You can also save to named slots, export or import save files, and optionally sync saves to a Google account.
- **Desktop and phone.** The game works with mouse and keyboard and on touch screens.

### New in 1.0.0

- **Plays offline and installs like an app.** After the first visit the game starts without a connection, and models, textures and sounds stay on your device. You can install it from the browser menu ("Install app" or "Add to Home Screen").
- **Faster start.** The capital city's renderer loads only when you first open the capital. Libraries are kept in separate files, so an update doesn't download them again. A loading screen shows while the game starts.
- **Crash protection.** If one window fails, only that window shows a message (with Try again) and the rest of the game keeps running. If the whole interface fails, a screen offers to save your reign to a file before you reload.
- **Autosave when you leave.** Switching tabs, minimising or closing the browser saves the reign.
- **Controls reference.** The Chancery (Esc menu) lists every keyboard and mouse control and shows the version.
- **Version shown** on the title screen and in the Chancery.

### Fixed

See the "Bug audit" section of [docs/RELEASE.md](docs/RELEASE.md) for how each bug was found and tested.

- An order to a star that doesn't exist (for example from a stale selection) could crash the game while finding a route. Such orders are now refused with "No route".
- Map camera keys (W A S D Q E) could stay held if you switched windows while pressing them, so the camera kept drifting. Held keys are now released when the window loses focus or a modifier key is pressed.
- Game shortcuts no longer catch browser shortcuts (Ctrl+1 to switch tabs), and they ignore text areas.
- Pressing Space while a button had focus both pressed the button and paused the game. Now it only pauses.
- Exporting a save could cancel the download in some browsers.
- Importing the same save file twice in a row did nothing. Importing a file that isn't a save now explains what went wrong.
