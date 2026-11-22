# AI balance pass (milestone 13d)

The AI follows the same rules as the player. Only its choices change here.

## Changes

1. **Resource operations:** an operation is founded as soon as one is affordable with a small reserve (station cost plus 60 minerals and 80 credits). Previously the AI waited for 250 minerals, which a mineral-poor realm never reached. When minerals are the limiting resource, it prefers mining sites.
2. **Market:** a rich treasury (more than 1,200 credits) over a nearly empty mineral store (under 250) buys minerals.
3. **Decrees:** the AI issues a decree once it holds the decree's cost plus a 40-influence reserve. Previously it waited for 110 influence, more than double the dearest decree (20–50).

A third change, using the whole builders' queue for the capital when the treasury allows, was tried and **dropped**. It left more realms stalled and slowed mid-game growth (see below).

## Evidence

The runs used six seeds (101–606), each for 60 years, on a medium galaxy with five major realms, all AI-driven (`scripts/kstat.ts` in the variant worktree; summarised here).

| Variant | Mean K, year 20 | Year 40 | Year 60 | Best realm per seed (mean) | Lowest K | Realms at Citadel ≤ 8 |
|---|---|---|---|---|---|---|
| Before | 0.82 | 1.10 | 1.75 | 2.68 | 0.94 | 2 |
| Operations + market | 0.83 | 1.21 | 1.82 | 2.67 | 0.81 | 0 |
| Decrees | 0.82 | 1.22 | 1.89 | 2.70 | 0.81 | 5 |
| Builders' queue only | 0.81 | 1.15 | 1.80 | 2.64 | 0.83 | 6 |
| **Operations + market + decrees (this branch)** | 0.82 | **1.27** | **1.85** | **2.84** | 0.83 | **0** |
| All three changes | 0.82 | 1.07 | 1.77 | 2.64 | 0.83 | 0 |

- An earlier three-seed run had suggested the changes lowered the mean Kardashev rating (1.79 to 1.49). The six-seed runs do not bear that out: the difference was seed variance.
- None of the changes lowers late-game progression.
- The chosen set ends stalled realms and raises the mean year-60 rating by about 6%.
