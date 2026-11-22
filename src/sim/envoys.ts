// Letters from rival rulers to the player. Rivals greet, warn, threaten, boast, thank and make
// peace in their own voice: an aggressive realm writes differently from a mercantile or a
// scholarly one. Letters change nothing by themselves; they make what the AI is already doing
// visible and give each rival a character. Choices are deterministic (no RNG draws), so adding
// letters does not change how a campaign plays out.

import type { Empire, GameState } from './types';
import { log } from './util';

export type LetterKind = 'greeting' | 'border' | 'threat' | 'ultimatum' | 'refused' | 'paid' | 'war' | 'peace' | 'thanks' | 'fear' | 'call' | 'joined' | 'losing';

type Temper = 'warlike' | 'courtly' | 'merchant' | 'scholar';

function temper(e: Empire): Temper {
  const p = e.personality;
  if (p.aggression >= 0.6) return 'warlike';
  if (p.mercantile >= 0.6) return 'merchant';
  if (p.science >= 0.6) return 'scholar';
  return 'courtly';
}

/** {me} = the player's realm, {us} = the writer's realm, {x} = a third party or a sum. */
const LINES: Record<LetterKind, Record<Temper, string[]>> = {
  greeting: {
    warlike: ['So the {me} has crawled out of the dark. Keep to your stars and we will keep to ours. For now.', 'We have seen your little fleet. Ours is larger. Remember that, and we will get along.'],
    courtly: ['The {us} greets the {me}. May our borders be quiet and our envoys busy.', 'Welcome, neighbour. The galaxy is wide enough for friends; let us be two of them.'],
    merchant: ['New neighbours mean new markets. The {us} would be glad to trade with the {me}.', 'Greetings! Whatever you make, we will buy, and whatever you need, we can sell. At a fair price, mostly.'],
    scholar: ['Another people among the stars. The {us} would very much like to compare notes with the {me}.', 'Greetings from the {us}. We hope you value knowledge as we do; there is much to learn together.'],
  },
  border: {
    warlike: ['Your outposts creep toward our space. One more and we will take it as an insult.', 'You are building very close to our border. Bold. Foolish, but bold.'],
    courtly: ['We note your new outpost near our border with some concern. Let us agree where your space ends and ours begins.', 'Our border grows crowded. We trust the {me} intends no offence.'],
    merchant: ['Your new claims sit on our trade routes. That is bad for business, and we are watching.', 'Expansion is good for trade, until it is our trade you expand into.'],
    scholar: ['Your claims approach systems our surveyors were studying. We would ask you to leave room for us.', 'We see you have claimed another system near ours. We hope curiosity, not hunger, drives you.'],
  },
  threat: {
    warlike: ['Your worlds are rich and your fleet is thin. That is a dangerous combination.', 'Enjoy your peace while it lasts.'],
    courtly: ['It grieves us to say so, but our council speaks of the {me} with little warmth these days.', 'Relations between our realms have cooled. We would not want them to freeze.'],
    merchant: ['Our generals have been asking what your worlds are worth. We told them: a great deal.', 'A war would be expensive. For you.'],
    scholar: ['Our strategists have been modelling a conflict with the {me}. The results were most instructive.', 'We have studied your defences. Thoroughly.'],
  },
  ultimatum: {
    warlike: ['Pay us {x} credits, or we will come and take far more.', 'A gift of {x} credits would buy you our goodwill. Refuse, and you will learn what our ill will costs.'],
    courtly: ['A token of respect, {x} credits, would do much to calm our council.', 'We ask {x} credits as a sign of friendship. We would be sorry to be refused.'],
    merchant: ['Call it a protection fee: {x} credits. It is cheaper than the alternative.', 'For {x} credits, our fleets will look elsewhere. A bargain, really.'],
    scholar: ['Our models suggest that {x} credits now is far cheaper for you than a war later.', 'We request {x} credits. The logic of your situation should be clear.'],
  },
  refused: {
    warlike: ['So be it. We will collect it ourselves.', 'You chose pride. We will make you regret it.'],
    courtly: ['Your refusal has been noted, and will be remembered.', 'We are disappointed. Our council will not soon forget this.'],
    merchant: ['No deal, then. Our generals will negotiate the next one.', 'A poor business decision. You will see.'],
    scholar: ['An irrational choice. We will adjust our plans accordingly.', 'You refuse. Interesting. We shall see whether that was wise.'],
  },
  paid: {
    warlike: ['A wise choice. Keep paying and keep breathing.', 'Good. You know your place.'],
    courtly: ['Your gift is gratefully received. Our realms will be the better for it.', 'Thank you. Our council speaks kindly of the {me} today.'],
    merchant: ['Pleasure doing business.', 'Paid in full. Our fleets have other appointments now.'],
    scholar: ['A logical decision. We appreciate it.', 'Received. Relations between us have improved measurably.'],
  },
  war: {
    warlike: ['Your worlds are ours by right of strength. Come and defend them, if you can.', 'War, at last. Our admirals have been looking forward to this.'],
    courtly: ['It is with regret that the {us} declares war. You left us no other path.', 'Diplomacy has failed. Let our fleets settle what our envoys could not.'],
    merchant: ['This is nothing personal. Your systems are simply too valuable to leave to you.', 'We have run the numbers. War is profitable.'],
    scholar: ['Our analysis is complete: war is the necessary course. We regret the waste.', 'We go to war. History will judge which of us was right.'],
  },
  peace: {
    warlike: ['Peace, then. Count yourselves lucky. Next time we will not stop.', 'We stop because we choose to, not because you made us.'],
    courtly: ['Let the guns fall silent. May this peace outlast the last one.', 'Peace is signed. Let us both remember what this war cost.'],
    merchant: ['The war is over. Shall we talk about trade?', 'Peace is good for business. Let us both get back to it.'],
    scholar: ['The war is concluded. A costly experiment for all involved.', 'Peace. Perhaps now we can return to more productive pursuits.'],
  },
  thanks: {
    warlike: ['A pact, then. Do not make us regret it.', 'Very well. We will stand with you, while it suits us both.'],
    courtly: ['The {us} rejoices in our new accord.', 'A fine day for both our realms. Our thanks.'],
    merchant: ['Signed and sealed. To mutual profit!', 'A good deal for both of us. We like those.'],
    scholar: ['An agreement that benefits us both. Excellent.', 'We are pleased. Cooperation is always the more efficient path.'],
  },
  fear: {
    warlike: ['You grow too strong, {me}. Strong realms make many enemies.', 'Every realm in the galaxy is watching you now. So are we.'],
    courtly: ['Your power alarms the courts of the galaxy. Tread carefully.', 'The {me} has grown mighty. Mighty realms are rarely loved.'],
    merchant: ['You own half the market now. Nobody likes a monopoly.', 'Your growth is bad for everybody else\'s business. People are talking.'],
    scholar: ['Our projections show the {me} dominating the galaxy. Many realms find those projections unacceptable.', 'You are winning. That makes you a problem to be solved.'],
  },
  call: {
    warlike: ['We fight the {x}. Join us and share the spoils, or stand aside and share nothing.', 'The {x} is weak and we are at its throat. Want a bite?'],
    courtly: ['We are at war with the {x}. Stand with us, and the {us} will not forget it.', 'The {x} threatens us both. Will the {me} take the field beside us?'],
    merchant: ['We will pay you to fight the {x}. Name your price; we already named ours.', 'Join our war against the {x}. There is money in it.'],
    scholar: ['Together we would defeat the {x} far faster. Join us; the payment is enclosed.', 'Our models show victory over the {x} is likely if you join us.'],
  },
  joined: {
    warlike: ['Now we hunt together!', 'Good. Let us break them.'],
    courtly: ['The {us} thanks you. We fight as one.', 'Your loyalty is noted and honoured.'],
    merchant: ['Excellent. The payment is yours, and soon the spoils.', 'A wise investment.'],
    scholar: ['A sound decision. Our odds have improved considerably.', 'Welcome to the coalition.'],
  },
  losing: {
    warlike: ['This is not over.', 'You have won a battle. Not the war.'],
    courtly: ['Perhaps it is time we spoke of peace.', 'Enough blood has been spilled. Shall we talk?'],
    merchant: ['This war has become unprofitable. Let us end it.', 'We are prepared to discuss terms.'],
    scholar: ['Our projections were wrong. We would discuss an end to this.', 'We concede the war has gone poorly. Peace?'],
  },
};

/** Send a letter from a rival ruler to the player (at most once per kind per `gapDays`). */
export function sendLetter(state: GameState, from: Empire, kind: LetterKind, x?: string | number, gapDays = 720): boolean {
  const me = state.empires[state.playerId];
  if (!me?.alive || from.id === me.id || !from.alive || from.role === 'pretender') return false;
  from.letters ??= {};
  const last = from.letters[kind];
  if (last != null && state.tick - last < gapDays) return false;
  from.letters[kind] = state.tick;
  const opts = LINES[kind][temper(from)];
  const text = opts[(state.tick + from.id * 7 + kind.length) % opts.length]
    .replace(/\{me\}/g, me.name).replace(/\{us\}/g, from.name).replace(/\{x\}/g, String(x ?? ''));
  log(state, { kind: 'envoy', severity: kind === 'war' || kind === 'ultimatum' || kind === 'threat' || kind === 'refused' ? 'warn' : 'info', title: `A letter from ${from.ruler || from.name}`, text: `“${text}” (${from.name})`, empires: [me.id] });
  return true;
}
