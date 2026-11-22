# Independent check of the nine reported bugs

An external audit reported nine bugs. Each was checked against the current code and its callers, and reproduced (or not) with a deterministic test before anything was changed. The tests live in `tests/audit9.test.ts`. Every test listed as *reproduced* failed on the unfixed code (main at `7a000be`) and passes after the fix.

## Summary

| # | Area | Verdict | Fixed |
|---|---|---|---|
| 1 | Market | **Confirmed exploit.** Buy-then-sell and sell-then-buy cycles made money; very large sales were priced at the opening price; storage overflow wasted credits; text amounts were accepted | Yes |
| 2 | Zero population | **False positive.** Both divisions are already guarded | No change; guard test added |
| 3 | AI invasions | **Confirmed bug (stalemate).** The AI stopped at 96 soldiers even when its target needed more, and its battle group waited in orbit for the rest of the war | Yes |
| 4 | Cloud chunks | **Confirmed bug.** Stale chunks after a smaller save, chunks left behind by delete, a read overlapping a write could mix two saves, and a missing chunk crashed the read | Yes |
| 5 | Combat | **Confirmed bug (stalemate).** A starbase left with under 1% hull was never captured | Yes |
| 6 | Cloud slots | **Confirmed path-injection bug** within the user's own folder. Cross-user access is governed by the Firestore rules, which tests cannot verify (see below). Save names that differ only in punctuation collided | Yes |
| 7 | Save loading | **Confirmed bug.** Structurally corrupt saves loaded silently and failed later, or loaded with null numbers | Yes |
| 8 | Route cache | The route cache itself is **a false positive**. The related supply-network cache had **a small confirmed gap** (same-day treaty swap) | The gap only |
| 9 | Megastructures | **Design gap.** The engine's blockade rule did not cover megastructures | Yes, with the existing rule |

## Details

### 1. Market (`src/sim/commands.ts`): confirmed exploit

**How it worked.** A whole order traded at the opening price, and the price moved afterwards by a factor of `1 + amount/3000`.

**What that allowed:**
- Buying 3,000 alloys doubled the price, so selling them straight back returned 1.6× the price against a cost of 1.2×. Ten cycles turned 1,000,000 credits into 1,015,600.
- Dumping goods then buying them back also made money: 1,000,000 became 1,031,994 credits.
- A sale over 3,000 units made the price factor zero or negative. The 25% price floor caught that, but the whole sale was still paid at the opening price.
- Purchases ignored storage, so goods beyond capacity were thrown away at day's end after the credits were spent.
- `Math.round('50')` let a text amount through.

**Fix.** Each unit now trades at the price reached so far. The price moves continuously by `e^(units/3000)`, held inside the existing bounds (0.25× to 4× the base price), and the value is the integral along that curve.

**Why there's no arbitrage.** Buying and selling walk the same price curve in opposite directions, so each unit sold is worth at most the price paid for its counterpart. A round trip therefore costs at least the fees. This holds even when a bound is reached.

**Also changed:**
- Small trades cost what they did within about 2% (a 100-unit order moves the price 3%).
- Orders must be finite numbers, of a tradable resource, up to 1,000,000 units.
- Purchases beyond storage room are refused with "Storage has room for only N".

**Tests:** repeated cycles at 50, 1,500, 3,000 and 6,000 units for three resources; dump and rebuy; large sales; price bounds over a hostile sequence; 13 malformed orders change nothing; storage; small-trade cost.

### 2. Zero population (`src/sim/economy.ts`): false positive

The only divisions involved are:
- `unemployed / c.pops`, which is guarded by `c.pops > 0`;
- `(c.pops - housing) / housing`, where housing starts at 5 and no building lowers it.

A colony set to zero population yields finite figures and keeps simulating. The test passed on the unfixed code. No change was made.

### 3. AI transports and invasions (`src/sim/ai.ts`): confirmed

**Campaigns alone didn't show it.** In ordinary campaigns (two seeds, 40 years, medium galaxy, hard), AI battle groups waited short of troops for at most 11 months, and invasions happened.

**A deterministic setup did.** It used:
- an AI realm with a strong fleet at war with a realm holding one shielded capital (40 pops, 6 garrisons), which needs about 230 troops;
- the transport target capped at `min(96, …)`;
- an attack order requiring `troops > need`.

The AI chose the world, built exactly 96 troops, and then waited in orbit with the war unresolved for nearly 5 years.

**Fix:**
- The ceiling is raised to `TROOP_CEILING = 240`, with the target sized to the actual need.
- Worlds needing more than the ceiling are no longer chosen as invasion targets.
- Transports have their own queue allowance (2 per shipyard), because a single shipyard full of colony ships and constructors was holding them back.

**Tests:** the same setup now passes 96 troops; a world needing more than 240 is never targeted.

### 4. Cloud chunks (`src/persistence/cloud.ts`): confirmed

These were reproduced with an in-memory Firestore stand-in (`tests/fixtures/fakeFirestore.ts`):
- Overwriting a 3-part save with a 1-part save left 2 stale parts.
- Delete removed only the parts the current metadata named.
- A read that overlapped another write combined parts of two saves and failed.
- A missing part threw `Cannot read properties of undefined`.

**Fix:**
- Every write has its own generation id, and parts are named `{gen}-{i}`. A reader only combines the parts its metadata names.
- After writing, a transaction on the metadata deletes the parts the metadata no longer names. Only parts listed before the transaction can be deleted, and the transaction re-runs if the metadata changes, so a write landing meanwhile is untouched.
- Reads retry when a newer write replaced the save mid-read. A part that is really missing gives "This cloud save is incomplete…".
- Delete removes every part of every generation, with the metadata first.
- Saves in the layout used before 1.0 (no generation, parts named `0`, `1`, …) are still read and are cleaned up by the next write.

**Tests:** shrinking and deleting; a missing part; a read overlapping a write; two overlapping writes; a write during cleanup; the legacy layout.

### 5. Near-destroyed starbases (`src/sim/combat.ts`): confirmed

**The mismatch.** A structure took part in battle only while its damage was below 0.99, but the end-of-battle check counted any hull above zero.

**The result:**
- A starbase left at, for example, 0.995 damage kept the battle "ongoing" that day.
- The next day it no longer counted, so the battle closed without a winner, and the capture check (which ran only when a battle concluded) never ran.
- Repairs need the system clear of enemies, so the system stayed with its owner while the enemy fleet sat in orbit indefinitely.

**Fix:**
- A structure left with under 1% hull is wrecked (damage 1).
- The end-of-battle check uses the same 0.99 threshold.
- A system with a wrecked starbase and no fighting is checked for capture, which also unblocks saves already stuck in this state.

**Tests:** a starbase at 0.995 with an enemy fleet present falls within days; a lopsided battle ends.

### 6. Cloud slot ids (`src/persistence/cloud.ts`): confirmed, within limits

**The bug.** The slot was inserted into the document path unchecked. A slot like `victim/chunks/0` writes to another save's part document inside the same user's folder.

**What tests can't show.** Cross-user isolation depends on the Firestore security rules, not on this code. The code always builds paths under `users/{current uid}/`, and the tests confirm that every operation stays inside the signed-in user's folder. Whether the deployed project enforces `request.auth.uid == uid` cannot be checked by tests that use a stand-in.

**Fix:**
- One validator (`src/persistence/slots.ts`, `^[a-z0-9_-]{1,200}$`, not Firestore's reserved `__…__` form) is applied to write, read and delete. It allows 200 characters so saves from earlier versions stay readable.
- The listing ignores documents with invalid ids.
- A `firestore.rules` file now encodes the user-scoped rule from DEVELOPMENT.md plus the same slot format. It is unverified: no emulator was available.

**Collisions.** Save names were slugged with information loss, so "My Save!" and "My Save?" overwrote each other. `slotForName` now appends a short tag of the exact name whenever the slug drops characters. The same name always gives the same slot, and slots stay at most 64 characters.

**Compatibility.** Saves made before this change keep their old slot. Saving again under the same name with punctuation creates a new slot next to the old one, and the old save stays loadable.

### 7. Corrupted saves (`src/sim/save.ts`): confirmed

`deserialize` checked only the version and that five keys existed, so corrupt saves loaded silently. Some then crashed later (`s.empires is not iterable`); others loaded with null numbers, which then spread as NaN.

**Fix.** `validateStructure` rejects:
- wrong types;
- references to systems, planets or realms that don't exist;
- numbers that aren't finite (JSON writes NaN and Infinity as `null`).

It never edits a save. It deliberately does not police ranges: values such as a stability of −0.6 or a resistance of 100.6 have been seen in real games and must not make a save unloadable. Fields added after the first release are checked only when present.

**Tests:**
- 15 corruption cases are refused with "Corrupt save: …".
- A legitimate save with odd but harmless values still loads and runs.
- The existing legacy v1 fixture and the round-trip tests pass unchanged.

### 8. Route cache (`src/sim/economy.ts`): mostly a false positive

**The route cache is sound.** It is a `WeakMap` keyed on the supply-network `Set` itself. That set is rebuilt whenever the day changes or any system changes owner (`setSystemOwner` bumps an epoch, and it is the only place ownership is written). The test (ownership changes on the same day) passed on the unfixed code. No invalidation was added.

**The real gap was in the supply network's own key.** It summarised treaties as a count plus a sum of partner ids. Swapping a non-aggression pact for an alliance between the same two realms on the same day kept the key, so the network stayed stale until the next day, even though alliances change who counts as a friend. The key now lists alliances and vassal ties exactly. The test failed before and passes now.

### 9. Megastructures under blockade (`src/sim/commands.ts`, `construction.ts`): design gap, existing rule applied

The engine already has one rule for hostile presence, `hostileArmedPresence`: an armed, hostile, non-guardian fleet stationed in the system. That rule stops:
- operation shipments ("blockaded");
- outposts;
- colonisation;
- invasions;
- structure repairs.

Megastructures ignored it. A project could be started with an enemy fleet in the system, and work and payments continued (5 → 8 days of progress under blockade in the test).

**Change.** Starting a project is refused under that rule, and work, including its daily payments, pauses while it holds, then resumes. Ownership was already handled correctly: every change of system owner moves its megastructures to the new owner.

Starbase upgrades also continue under blockade. They were not part of this report, so they were left as they are.

## Verification

See the pull request for the commands and their results.
