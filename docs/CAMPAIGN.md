# Campaign balance: evidence

How whole campaigns play out per difficulty, measured with `scripts/campaign.ts`.

```
npx vite-node scripts/campaign.ts -- [years] [difficulties] [seeds] [size]
npx vite-node scripts/campaign.ts -- 100 relaxed,standard,hard 101,202,303 medium
```

## Method

- **Setup:** medium galaxy (60 systems), five great realms and three minor ones. Runs last 100 years, with snapshots at 30, 60 and 100.
- **The player's realm** is played by the AI at the standard preset, with a balanced temperament. It stands in for a competent player, so the numbers show how hard each difficulty's rivals push that realm. A human plays better in some respects (focus, timing) and worse in others (attention).
- **Measured:**
  - wars, and wars declared on the player;
  - falls (realms eliminated, including minor realms);
  - survival of the player's realm and its rank by systems;
  - the Kardashev rating;
  - eras and megastructure stages;
  - the leader's share of all systems, and "snowball" (the leader's systems over the median's);
  - "passive rival-years": years in which a living great realm had neither gained a system nor fought for ten years;
  - victories: the first one achieved by any realm, with year and kind.
- **Victories** use the same checks as the game (`src/sim/victory.ts`). The baseline harness could not track domination holds, so its domination column is empty by construction.

## Baseline (before this work)

Old AI, standard difficulty, three seeds, 100 years. On standard the old AI had no output bonus.

| Year | Wars | Falls | Player rank | Mean K | Top share | Snowball | Passive rival-years | Victories |
|---|---|---|---|---|---|---|---|---|
| 30 | 12.3 | 0.3 | 2.0 | 1.10 | 25% | 1.4× | 2.3 | none |
| 60 | 35.7 | 0.3 | 1.7 | 1.88 | 28% | 1.6× | 9.7 | none |
| 100 | 65.7 | 0.3 | 2.3 | 2.93 | 32% | 1.7× | 10.7 | ascension at 81 (AI), 91 (AI), 87 (player) |

The old relaxed and hard runs gave the AI −15% and +25% output. Seed 101 shows the pattern: about 60 wars per century and no great realm ever fell. Wars were border skirmishes, settled for tribute or a status quo. Ascension came at year 61 (hard, the player's realm) and year 93 (relaxed, AI).

What the baseline showed:

- Wars changed little. Over 100 years, no great realm ever fell.
- Supremacy was effectively unreachable.
- Domination (60% of all systems) never came close.
- Ascension was the only road to victory.
- Difficulty only scaled AI output.

## First pass of the new AI (before the war fixes)

| Difficulty | Year 100 wars | On the player | Player rank | Top share | Passive | Victories |
|---|---|---|---|---|---|---|
| Relaxed | 32.7 | 0.7 | 1.0 | 38% | 66.7 | ascension at 63, 82 and 93 (all the player) |
| Standard | 45.0 | 3.3 | 2.0 | 34% | 26.0 | ascension at 51 (AI) and 70 (player) |
| Hard | 45.0 | 3.0 | 2.7 | 42% | 14.3 | domination at 52 (AI), ascension at 56 and 62 (AI) |

- Difficulty now mattered: on Relaxed the player's realm won every run, and on Hard the AI won every run.
- Diagnosed problems:
  - Invasions landed piecemeal and were repulsed (14 of 21 failed in one 40-year run).
  - Winners settled for tribute after 18 months.
  - By year 40, everlasting non-aggression pacts left no realm with a legal target. This is the high passive count.

## Third pass: decisive wars

These results come after the war fixes: escorted landings sized to the garrison, winners press on, pacts lapse after 15 years or are renounced, vassals break free, counter-building. They come before the coalition fixes. Three seeds, 100 years.

| Difficulty | Year | Wars | On the player | Falls | Player rank | Top share | Snowball | Passive | Victories |
|---|---|---|---|---|---|---|---|---|---|
| Relaxed | 30 | 11.3 | 0.0 | 1.3 | 1.3 | 39% | 2.6× | 0.7 | |
| Relaxed | 100 | 22.7 | 0.0 | 1.7 | 1.0 | 54% | 4.6× | 9.0 | domination at 35 and 36 (the player), ascension at 60 (AI) |
| Standard | 30 | 9.7 | 1.3 | 0.3 | 2.0 | 36% | 2.9× | 0.7 | |
| Standard | 100 | 25.7 | 4.0 | 1.7 | 2.3 | 62% | 5.0× | 8.0 | domination at 30 (AI), ascension at 69 and 72 (AI) |
| Hard | 30 | 12.7 | 0.3 | 1.3 | 2.0 | 34% | 1.9× | 2.3 | |
| Hard | 100 | 31.0 | 2.7 | 1.7 | 1.7 | 51% | 4.9× | 5.0 | domination at 52 (the player), ascension at 55 (AI) and 70 (the player) |

- **Falls:** realms are now eliminated, on average 1.7 per campaign (minor and great realms). Two great realms fell in two of the nine runs.
- **Passive rival-years:** these fell from 14–67 to 5–9.
- **Victory variety:** four domination victories and five ascension victories, won by the player's realm and by AI rivals alike. Supremacy was achieved in earlier passes, but there it came too easily: one realm vassalised every rival by year 36. Great realms are now vassalised only when broken, and vassals rise again when they can.
- **Remaining problem: runaway leaders.** The leader ends with about 5× the median realm's systems, and one standard rival won by domination at year 30. This led to the coalition fixes: rivals of the feared leader count each other's wars against it, and need less strength to join in.
- **Difficulty:** this pass does not show a clean gradient. Hard rivals fight each other more (31 wars against 23 on relaxed), which weakens them. Three seeds are few.

## Current

All fixes are in: decisive wars, lapsing and renounced pacts, vassal risings, counter-building and coalitions against the leader. Four seeds (101–404), 100 years, snapshots at 30, 60 and 100.

| Difficulty | Year | Wars | On the player | Falls | Player rank | Mean K | Top share | Passive | Victories so far |
|---|---|---|---|---|---|---|---|---|---|
| Relaxed | 30 | 12.0 | 0.0 | 1.0 | 1.0 | 1.07 | 38% | 0.3 | none |
| Relaxed | 60 | 21.0 | 0.0 | 2.0 | 1.0 | 2.01 | 52% | 3.0 | 3 |
| Relaxed | 100 | 25.5 | 0.3 | 2.0 | 1.0 | 2.42 | 56% | 3.5 | domination at 40, 50 and 70 (the player), ascension at 58 (AI) |
| Standard | 30 | 12.8 | 0.8 | 0.3 | 2.0 | 1.00 | 39% | 1.0 | none |
| Standard | 60 | 21.3 | 2.0 | 1.3 | 2.0 | 1.70 | 50% | 3.3 | 2 |
| Standard | 100 | 26.8 | 2.8 | 1.3 | 1.5 | 2.77 | 51% | 11.8 | domination at 33 (AI) and 36 (the player), ascension at 61 (the player) and 95 (AI) |
| Hard | 30 | 12.5 | 0.3 | 0.8 | 2.8 | 0.96 | 33% | 2.0 | none |
| Hard | 60 | 23.5 | 3.0 | 2.0 | 1.8 | 1.66 | 45% | 2.8 | 1 |
| Hard | 100 | 37.5 | 6.0 | 2.0 | 1.8 | 2.59 | 46% | 2.8 | domination at 37 (AI), ascension at 60 and 90 (AI) and 83 (the player) |

### What the numbers say

- **Difficulty is a real gradient.** Every preset plays by the same rules and receives the same resources.

  | Difficulty | Player's realm wins | Wars declared on it per century |
  |---|---|---|
  | Relaxed | 3 of 4 | 0.3 |
  | Standard | 2 of 4 | 2.8 |
  | Hard | 1 of 4 | 6.0 |

  The player's realm survived every run.
- **Wars decide things.** About 25–38 wars per century, against about 66 for the old AI. They are fewer but larger: two realms fall per campaign on average, and great realms were eliminated in several runs.
- **No passive late game.** Passive rival-years are 3–12 per campaign, against 10–67 before.
- **Every road to victory is reachable.**
  - Domination: 7 of 12 victories, between years 33 and 70.
  - Ascension: 5 of 12, between years 58 and 95.
  - Supremacy: achieved in an earlier pass (too early, now fixed), and not in this suite.
  - Every campaign ended in a victory within 100 years. The AI won 6 of 12, the player's realm 6 of 12.
- **Runaway leaders are checked, not eliminated.** Coalitions now form (8–21 defensive pacts against a leader per campaign). Hard rivals gang up on the leader hardest. Seed 101 still produces an early AI domination at year 33 on standard and year 37 on hard. The two-year hold and the warnings give a human player time to act; the AI stand-in does not use it.
- **Snowball** is now dominated by realms shrinking: the median realm can fall to 1–2 systems. The leader's share of all systems is the better measure; it ends at 46–56% of the galaxy.

### Known limits of this evidence

- Twelve campaigns on one galaxy size. The 10,000-system Milky Way was checked for speed (13.9 ms per day under load, against a limit of 20), not for balance.
- The player's realm is AI-driven. A human will play differently, especially in using the warnings: rivals arming, a domination hold starting.
- The numbers move between seeds. Read the trends, not the exact values.

