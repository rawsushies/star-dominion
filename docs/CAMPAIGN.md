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

## Current

(Filled in from the latest suite; see below.)
