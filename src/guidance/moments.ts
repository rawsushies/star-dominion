// "What just happened?" cards. The first time something new happens to the player (they meet
// another realm, a war is declared on them, enemy ships arrive, a battle starts, something runs
// out, a new screen joins the bar), one short card explains it in plain words and says what to do.
// Each card is shown once per reign. Cards about danger pause the game so there is time to read.

import type { GameState } from '../sim/types';
import type { ScreenId } from '../ui/store';
import { hasContact } from '../sim/diplomacy';
import { getLedger } from '../sim/engine';
import { hostileArmedPresence } from '../sim/territory';
import { guidanceOf } from './state';
import { freshUnlock } from './path';
import { NAV_LABEL } from './labels';
import type { VoiceId } from './advisor';
import { PROLOGUE_STAGES, currentStage, pretenderOf } from '../sim/prologue';
import { orbitSecured } from '../sim/fleets';
import { isHostile } from '../sim/territory';

export interface Moment {
  /** recorded as `moment:<id>` once dismissed */
  id: string;
  title: string;
  text: string;
  /** the game is paused when the card appears */
  pause?: boolean;
  danger?: boolean;
  /** shown even while a lesson runs */
  interrupt?: boolean;
  /** the advisor's recorded line for this moment */
  voice?: VoiceId;
  action?: { label: string; screen?: ScreenId; systemId?: number; fleetId?: number; planetId?: number };
}

const LABEL: Record<string, string> = { credits: 'credits', minerals: 'minerals', energy: 'energy', food: 'food', alloys: 'alloys', electronics: 'electronics', components: 'components', rare: 'rare elements' };

function candidates(g: GameState): Moment[] {
  const me = g.empires[g.playerId];
  const out: Moment[] = [];
  const pid = g.playerId;
  const myWars = g.wars.filter((w) => w.attackers.includes(pid) || w.defenders.includes(pid));

  // a war declared on us
  const onUs = myWars.find((w) => w.defenders.includes(pid));
  if (onUs) {
    const foe = g.empires[onUs.attackers[0]];
    out.push({
      id: 'war-on-you', pause: true, danger: true, voice: 'war_on_you',
      title: `${foe.name} has declared war on you`,
      text: `War means their warships can now fly into your space, fight your ships and land soldiers on your planets to take them. What to do: build warships at your shipyard and keep them at your home planet, where your space station helps them fight. Wars end with a peace deal: the Military screen is where you offer one.`,
      action: { label: 'Open Military', screen: 'military' },
    });
  }

  // enemy warships inside our space
  const owned = g.galaxy.systems.filter((s) => s.owner === pid);
  const invaded = myWars.length ? owned.find((s) => hostileArmedPresence(g, pid, s.id)) : undefined;
  if (invaded) out.push({
    id: 'enemy-in-space', pause: true, danger: true, voice: 'enemy_in_space',
    title: `Enemy warships are in ${invaded.name}`,
    text: 'Enemy ships are inside your borders. If they beat your space station and planet defences, they can land troops and take your planet. Send your warships there (select your fleet, then right-click the star), or pull back and gather more ships first.',
    action: { label: `Show ${invaded.name}`, systemId: invaded.id },
  });

  // our first battle
  const battle = g.battles.find((b) => b.sides.some((side) => side.includes(pid)));
  if (battle) out.push({
    id: 'first-battle', interrupt: true, voice: 'first_battle',
    title: 'Your ships are in a battle',
    text: 'When enemy warships meet yours, they fight on their own: you do not aim or fire. The side with more and stronger ships usually wins. If a battle is going badly, move your fleet away to save what is left. Click the battle in the Dispatches (bottom left) to watch it.',
    action: { label: 'Open Military', screen: 'military' },
  });

  // a peace offer waiting for us
  const peace = g.proposals.find((p) => p.to === pid && p.kind === 'peace');
  if (peace) out.push({
    id: 'peace-offer', interrupt: true, voice: 'peace_offer',
    title: `${g.empires[peace.from].name} offers peace`,
    text: 'They want to end the war. If you accept, the fighting stops and each side keeps what it holds, plus whatever the offer says. If you are winning, you can refuse and ask for more later. Answer it in Diplomacy.',
    action: { label: 'Open Diplomacy', screen: 'diplomacy' },
  });

  // first contact
  const met = g.empires.find((x) => x.alive && x.id !== pid && (x.kind === 'major' || x.kind === 'minor') && hasContact(g, pid, x.id));
  if (met) out.push({
    id: 'first-contact', voice: 'first_contact',
    title: `You have met the ${met.name}`,
    text: `${met.kind === 'major' ? 'They are another great realm, like yours, run by the computer, and they also want to win.' : 'They are a small independent realm: weaker than you, and a possible first target if you want to try conquering.'} Realms can become friends (treaties), stay neutral, or go to war. For now, just keep an eye on them. The Diplomacy screen lists everyone you have met and what they think of you.`,
    action: { label: 'Open Diplomacy', screen: 'diplomacy' },
  });

  // something ran out
  const short = getLedger(g, me).shortages.find((r) => r !== 'influence');
  if (short) out.push({
    id: 'first-shortage', pause: true, voice: 'shortage',
    title: `You have run out of ${LABEL[short] ?? short}`,
    text: `Your realm uses more ${LABEL[short] ?? short} each month than it makes, and the store is empty. ${short === 'food' ? 'People will go hungry and your planets will shrink.' : short === 'energy' ? 'People get unhappy and work less.' : short === 'credits' ? 'You cannot pay for your ships and buildings.' : 'Anything that needs it works slowly.'} Fix it by building more of what makes it (on the Planets screen), or buy some on the market in the Economy screen.`,
    action: { label: 'Open Economy', screen: 'economy' },
  });

  // our first outpost
  if (owned.length >= 2) out.push({
    id: 'first-outpost',
    title: 'A new system is yours',
    text: 'Your outpost is finished. The system now belongs to you: its border is your border and anything in it can be used later. Each new system makes your realm bigger and richer, and also gives you more border to defend.',
  });

  // a rival preparing war on us (the AI telegraphs it)
  const arming = g.empires.find((r) => r.alive && r.aiPlan?.goal === 'arm' && r.aiPlan.target === pid);
  if (arming) out.push({
    id: 'rival-arming', danger: true, voice: 'rival_arming',
    title: `${arming.name} is getting ready to attack you`,
    text: 'They are building warships aimed at you. You have some time. Build warships of your own, keep them at home, and look for a friend: a defence pact in Diplomacy means another realm joins your side if you are attacked.',
    action: { label: 'Open Diplomacy', screen: 'diplomacy' },
  });

  // the Prologue: each quest stage, introduced as it begins
  const stage = currentStage(g);
  const pr = pretenderOf(g);
  if (stage && pr) {
    const i = PROLOGUE_STAGES.indexOf(stage);
    out.push({
      id: `quest-${stage.id}`, voice: i === 0 ? 'pretender' : (`quest_${stage.id}` as VoiceId),
      title: i === 0 ? 'Your first quest: the Pretender' : `Quest ${i + 1} of ${PROLOGUE_STAGES.length}: ${stage.title}`,
      text: `${i === 0 ? `${pr.ruler} holds a world near us and claims your crown. Take it back one step at a time; the great realms leave you alone until you do. ` : ''}Next: ${stage.goal}`,
    });
  }
  if (g.prologue?.done) out.push({ id: 'prologue-done', interrupt: true, voice: 'prologue_done', title: 'The Prologue is over', text: 'The Pretender is gone and your realm is ready. From now on the great realms may treat you as a rival: they can make friends with you, or come for you. Your goal now is to win the galaxy. The Throne room shows the three ways to win and how close everyone is.', action: { label: 'Open Throne room', screen: 'throne' } });

  // your own war, the fight in orbit, a world taken, peace
  const mine = myWars.find((w) => w.attackers[0] === pid);
  if (mine) out.push({ id: 'you-declared', interrupt: true, voice: 'declare', title: `You are at war with the ${g.empires[mine.defenders[0]].name}`, text: 'From now on their ships and yours fight wherever they meet, and either side can land troops on the other\'s planets. Keep your fleet together: one big fleet beats two small ones.' });
  if (myWars.length) {
    const won = Object.values(g.fleets).find((f) => f.ownerId === pid && f.ships.length && g.galaxy.systems[f.systemId].planetIds.some((p) => { const c = g.planets[p].colony; return !!c && c.ownerId !== pid && isHostile(g, pid, c.ownerId) && orbitSecured(g, pid, p); }));
    if (won) out.push({ id: 'orbit-won', interrupt: true, voice: 'orbit', title: 'The sky above the enemy world is yours', text: 'No enemy ships, station or defence guns are left there. Now soldiers can land: select the planet and press Invade. Bring more soldiers than it has defenders.', action: { label: `Show ${g.galaxy.systems[won.systemId].name}`, systemId: won.systemId } });
  }
  const recent = g.events.slice(-60);
  const took = recent.find((e) => e.kind === 'invasion' && e.planetId != null && /captured/.test(e.title) && g.planets[e.planetId].colony?.ownerId === pid);
  if (took) out.push({ id: 'captured', interrupt: true, voice: 'captured', title: `${g.planets[took.planetId!].name} is yours`, text: 'Its people, buildings and system now belong to your realm. Newly taken worlds are unhappy for a while, so expect low stability at first. Keep the war going or make peace: either way the planet stays yours.', action: { label: 'Open the planet', screen: 'planets', planetId: took.planetId! } });
  const lost = recent.find((e) => e.kind === 'invasion' && e.planetId != null && /captured/.test(e.title) && e.empires.includes(pid) && g.planets[e.planetId].colony?.ownerId !== pid && g.planets[e.planetId].colony != null);
  if (lost) out.push({ id: 'planet-lost', danger: true, voice: 'planet_lost', title: `${g.planets[lost.planetId!].name} has fallen`, text: 'Enemy soldiers have taken one of your worlds. You can take it back the same way: clear the sky above it with warships, then land more soldiers than it has defenders. Or make peace and let it go.', action: { label: 'Open Military', screen: 'military' } });
  const signed = recent.find((e) => e.kind === 'peace' && (e.title.includes(me.adjective) || e.text.includes(me.name)));
  if (signed) out.push({ id: 'peace-signed', interrupt: true, voice: 'peace', title: 'Peace is signed', text: 'The war is over. A five-year truce means neither side can attack the other until it ends. Your ships can go home and rest, and you can spend on building again.' });
  const threat = recent.find((e) => e.kind === 'victory_threat' && e.severity === 'danger');
  if (threat) out.push({ id: 'rival-near-win', danger: true, voice: 'rival_near_win', title: threat.title, text: 'A rival is close to winning the whole game. If they get there, your reign ends. Other realms are worried too: offer them a defence pact, or attack the leader together to take systems from them.', action: { label: 'Open Throne room', screen: 'throne' } });
  if (me.dominationSince != null) out.push({ id: 'near-win', interrupt: true, voice: 'near_win', title: 'You are close to winning', text: 'You hold enough of the galaxy to win by domination. Keep it for two years and the galaxy is yours. Expect your rivals to team up against you.', action: { label: 'Open Throne room', screen: 'throne' } });

  // a screen joining the bar (beginner mode)
  const unl = freshUnlock(g);
  if (unl) out.push({
    id: `unlock-${unl.id}`, ...(unl.id === 'vault' ? { voice: 'relics' as VoiceId } : {}),
    title: `New on your left bar: ${NAV_LABEL[unl.id] ?? unl.id}`,
    text: unl.why,
    action: { label: `Open ${NAV_LABEL[unl.id] ?? unl.id}`, screen: unl.id },
  });

  return out;
}

/** The card to show now, if any: danger first, then in the order above. */
export function currentMoment(g: GameState): Moment | null {
  const s = guidanceOf(g);
  // while a lesson is running, only danger (and meeting someone) interrupts it
  const lesson = !!s.active && !s.paused;
  const list = candidates(g).filter((m) => !s.seen.includes(`moment:${m.id}`) && (!lesson || m.danger || m.interrupt || (m.id === 'first-contact' && s.active === 'grow')));
  return list.find((m) => m.danger) ?? list[0] ?? null;
}

export function dismissMoment(g: GameState, m: Moment) {
  const s = guidanceOf(g);
  s.seen.push(`moment:${m.id}`);
  if (m.id.startsWith('unlock-')) s.seen.push(`unl:${m.id.slice(7)}`);
}
