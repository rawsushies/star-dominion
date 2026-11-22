# Star Dominion

**Version 1.0.0** · [Changelog](CHANGELOG.md) · [Release notes](docs/RELEASE.md)

An interstellar kingdom grand-strategy game in the browser. Rule a young civilisation, expand across a procedural galaxy, run a real production economy, build fleets, deal with AI kingdoms, and evolve your people from feudal houses to a Type V civilisation.

- Real-time with pause, deterministic simulation, 13 hull classes, 6 governments, 60 technologies
- Floating-window HUD over a live galaxy; real-time 3D planets and star systems (Three.js)
- Civilisational eras on a Kardashev ladder, with an ascension victory
- Guided first reign for new players
- Three ways to win (domination, supremacy, ascension) against AI realms with their own ambitions
- Local saves with autosave, save files, plus optional Google-account cloud saves (Firebase)
- Plays offline after the first visit and installs like an app (desktop and phone)

## Playing

Open the game in a current desktop or mobile browser with WebGL 2 (Chrome, Edge, Firefox, Safari). On the title screen, leave **Guided first reign** ticked if you are new: a starter quest and short lessons teach the game step by step. Press **Esc** in game for the Chancery (save, load, settings and the list of controls).

To install: use the browser's "Install app" (desktop) or "Add to Home Screen" (phone) once the game has loaded.

## Building

```bash
npm install
npm run dev     # play at http://localhost:5173
npm test        # simulation tests + 30-year soak
```

Read more: [GAME_DESIGN.md](GAME_DESIGN.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DEVELOPMENT.md](DEVELOPMENT.md)
