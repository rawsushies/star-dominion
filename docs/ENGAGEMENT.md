# Engagement features

What makes a reign feel alive beyond the core simulation. Each feature lists where it lives and how it was checked.

## Lord Admiral Fiona MacLeod (the advisor)

The tutorial is presented by a character, with a portrait, a name and a recorded Scottish voice. She speaks only at important moments, each line once per reign. See `docs/GUIDANCE.md` and `docs/AUDIO.md`.

## The Prologue

This is a starter quest for guided reigns: take back the crown world from a weak Pretender, in five stages with rewards. The great realms leave the player alone until it ends (at most 6 years). Code: `src/sim/prologue.ts`; tests: `tests/prologue.test.ts`. A scripted player following the lessons finishes it in 1.2 to 1.3 game years on six maps.

## Quest beacons

A pulsing gold "Quest" marker on the galaxy map shows where the current objective is: free systems to claim, the Pretender's world, or the war lesson's target. When the objective is off screen, an arrow at the screen edge points to it with the system's name. Code: `src/guidance/beacons.ts`, drawn in `src/ui/render/galaxy3d.ts`.

## Rivals that act like players

- **Letters** (`src/sim/envoys.ts`). Rival rulers write to the player in a voice that matches their temperament (warlike, courtly, merchant, scholar). They write about:
  - first contact;
  - outposts on their border;
  - arming against you;
  - ultimatums;
  - refusals and payments;
  - declarations of war;
  - peace and thanks for treaties;
  - fear of a leading player;
  - calls to arms;
  - losing a war.

  Letters only make visible what the AI is already doing. They are chosen deterministically, so they do not change how a campaign plays.
- **Ultimatums with consequences.** An aggressive, much stronger neighbour demands tribute. If you refuse, they remember it (opinion −30) and arm against you. If you pay, you earn goodwill. Never during the Prologue.
- **Calls to arms.** A war leader that is not clearly winning asks realms with a grudge against its enemy to join:
  - AI realms decide on opinion, grudge and the odds;
  - the player is offered payment and decides in Diplomacy;
  - each realm is asked once per war;
  - joining breaks treaties with the enemy, and both sides remember it.
- **Opportunism.** A realm that is losing another war, or worn down by one, is a likelier target.
- Tests: `tests/rivals.test.ts`. Campaign evidence: `docs/CAMPAIGN.md`.

## The Relic Vault (gacha, no real money)

- **Earning relics:**
  - 3 at the start;
  - +1 per Prologue quest and +2 when it ends;
  - +1 per ambition;
  - +2 per new era;
  - +2 per war won (not status quo);
  - +1 per decisive battle won (at least 2 enemy ships destroyed).
- **Draw results:**

  | Rarity | Odds | What you get |
  |---|---|---|
  | Common | 60% | A cache of alloys, credits, minerals or influence |
  | Rare | 28% | A warship with +15% firepower and hull, or a level 3 hero |
  | Epic | 10% | A warship with +30% firepower and hull, or a level 5 hero |
  | Legendary | 2% | A unique named warship with +60% firepower and hull, or a unique named level 8 hero |

- **Guarantees:**
  - every tenth draw without an epic becomes epic;
  - a legendary comes within 40 draws;
  - each legendary can be drawn once per reign.
- **Player only.** AI realms never draw. The vault is a reward loop for the player, not a hidden handicap for rivals.
- Code: `src/sim/relics.ts`, `src/ui/screens/Vault.tsx`. Tests: `tests/relics.test.ts` (the guarantees over 400 draws, a relic ship stronger than a plain one, save round-trip) and `tests/e2e/vault.spec.ts`.
