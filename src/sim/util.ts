import { RESOURCES, type Cost, type Empire, type GameEvent, type GameState, type Stock } from './types';

export function emptyStock(): Stock {
  return Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Stock;
}

export function scaleCost(c: Cost, m: number): Cost {
  const out: Cost = {};
  for (const k in c) out[k as keyof Cost] = Math.ceil(((c as any)[k] as number) * m);
  return out;
}

export function canAfford(e: Empire, c: Cost): boolean {
  for (const k in c) if (e.stock[k as keyof Stock] + 1e-9 < ((c as any)[k] as number)) return false;
  return true;
}

export function pay(e: Empire, c: Cost): boolean {
  if (!canAfford(e, c)) return false;
  for (const k in c) e.stock[k as keyof Stock] -= (c as any)[k] as number;
  return true;
}

export function refund(e: Empire, c: Cost, frac = 1) {
  for (const k in c) e.stock[k as keyof Stock] += ((c as any)[k] as number) * frac;
}

export function costValue(c: Cost): number {
  // rough credit value used for loss accounting and AI valuation
  const w: Record<string, number> = { credits: 1, minerals: 0.5, energy: 0.4, food: 0.4, alloys: 2, electronics: 2.5, components: 5, rare: 4, influence: 6 };
  let v = 0;
  for (const k in c) v += ((c as any)[k] as number) * (w[k] ?? 1);
  return v;
}

export function nextId(state: GameState): number {
  return state.nextId++;
}

export function log(
  state: GameState,
  ev: Omit<GameEvent, 'id' | 'tick'>,
) {
  state.events.push({ ...ev, id: nextId(state), tick: state.tick });
  if (state.events.length > 600) state.events.splice(0, state.events.length - 600);
}

export function formatDate(tick: number): string {
  const year = 2400 + Math.floor(tick / 360);
  const month = Math.floor((tick % 360) / 30) + 1;
  const day = (tick % 30) + 1;
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}
