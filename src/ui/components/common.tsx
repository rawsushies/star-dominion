import { useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Cost, Empire, ResId } from '../../sim/types';
import type { LedgerKey } from '../../sim/economy';

export const RES_META: Record<LedgerKey, { label: string; color: string }> = {
  credits: { label: 'Credits', color: '#c8a35a' },
  minerals: { label: 'Minerals', color: '#b8ae98' },
  energy: { label: 'Energy', color: '#e3c95a' },
  food: { label: 'Food', color: '#7fbf7f' },
  alloys: { label: 'Alloys', color: '#9fb4c8' },
  electronics: { label: 'Electronics', color: '#6fb0d9' },
  components: { label: 'Components', color: '#c48fb0' },
  rare: { label: 'Rare elements', color: '#a98fd6' },
  influence: { label: 'Influence', color: '#d98a6f' },
  research: { label: 'Research', color: '#7fd1c4' },
};

export function fmt(n: number, digits = 0): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  if (a >= 1000) return (n / 1e3).toFixed(2) + 'k';
  return n.toFixed(digits);
}
export function signed(n: number, digits = 1): string {
  const s = Math.abs(n) < 0.05 && digits > 0 ? '0' : fmt(n, Math.abs(n) >= 100 ? 0 : digits);
  return n > 0.049 ? `+${s}` : s;
}
export function cls(...xs: (string | false | null | undefined)[]) { return xs.filter(Boolean).join(' '); }

/** Small geometric resource glyphs (original, single-colour). */
export function ResGlyph({ r, size = 12 }: { r: LedgerKey; size?: number }) {
  const c = RES_META[r].color;
  const s = size;
  const p: Record<LedgerKey, ReactNode> = {
    credits: <><circle cx="6" cy="6" r="4.6" fill="none" stroke={c} strokeWidth="1.4" /><circle cx="6" cy="6" r="1.6" fill={c} /></>,
    minerals: <path d="M6 1 L10.5 3.6 L10.5 8.4 L6 11 L1.5 8.4 L1.5 3.6 Z" fill="none" stroke={c} strokeWidth="1.4" />,
    energy: <path d="M7 1 L2.5 7 L5.6 7 L4.8 11 L9.5 4.8 L6.4 4.8 Z" fill={c} />,
    food: <path d="M6 11 C2 8 2 4 6 1 C10 4 10 8 6 11 Z M6 3 L6 10" fill="none" stroke={c} strokeWidth="1.3" />,
    alloys: <><rect x="1.5" y="6.5" width="9" height="3" fill={c} /><rect x="3" y="2.5" width="6" height="3" fill={c} opacity="0.7" /></>,
    electronics: <><rect x="3" y="3" width="6" height="6" fill="none" stroke={c} strokeWidth="1.3" /><path d="M1 5h2M1 7h2M9 5h2M9 7h2M5 1v2M7 1v2M5 9v2M7 9v2" stroke={c} strokeWidth="1" /></>,
    components: <><circle cx="6" cy="6" r="2.4" fill="none" stroke={c} strokeWidth="1.4" /><path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M2.5 9.5l1.4-1.4M8.1 3.9l1.4-1.4" stroke={c} strokeWidth="1.2" /></>,
    rare: <path d="M6 1 L10 6 L6 11 L2 6 Z" fill={c} />,
    influence: <path d="M1.5 9 L1.5 4 L4 6 L6 2 L8 6 L10.5 4 L10.5 9 Z" fill={c} />,
    research: <path d="M4.5 1.5h3M5 1.5v3.2L2 10h8L7 4.7V1.5" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />,
  };
  return <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden style={{ flex: 'none' }}>{p[r]}</svg>;
}

export function CostView({ cost, empire, showShort = true }: { cost: Cost; empire?: Empire; showShort?: boolean }) {
  const entries = Object.entries(cost).filter(([, v]) => (v as number) > 0) as [ResId, number][];
  if (!entries.length) return <span className="faint">Free</span>;
  return (
    <span className="cost">
      {entries.map(([k, v]) => (
        <span key={k} className={showShort && empire && empire.stock[k] < v ? 'short' : ''}>
          <ResGlyph r={k} size={11} />{fmt(v)}
        </span>
      ))}
    </span>
  );
}

// ---------- tooltip ----------
export function Tip({ content, children, style, className }: { content: ReactNode; children: ReactNode; style?: CSSProperties; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', ...style }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && content && createPortal(
        <div className="tip" style={{ left: Math.min(pos.x + 14, window.innerWidth - 350), top: Math.min(pos.y + 16, window.innerHeight - 40) }}>{content}</div>,
        document.body,
      )}
    </span>
  );
}

export function Meter({ value, max = 100, tone }: { value: number; max?: number; tone?: 'v' | 'r' }) {
  return <div className={cls('meter', tone)}><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>;
}

export function Sheet({ title, lede, actions, children }: { title: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="sheet-head">
        <div className="sheet-title">{title}</div>
        {lede && <div className="lede">{lede}</div>}
        <div className="actions">{actions}</div>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  );
}

export function Section({ title, aside, children, style, guide }: { title: ReactNode; aside?: ReactNode; children: ReactNode; style?: CSSProperties; /** anchor for lesson highlights */ guide?: string }) {
  return (
    <div className="section" style={style} data-guide={guide}>
      <h3><span>{title}</span>{aside != null && <span className="aside">{aside}</span>}</h3>
      {children}
    </div>
  );
}

export function Stat({ k, v, s, tone }: { k: string; v: ReactNode; s?: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={cls('v', tone)}>{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} />;
}

export function Emblem({ empire, size = 30 }: { empire: Empire; size?: number }) {
  // heraldic lozenge with a simple charge chosen by emblem index
  const c = empire.color;
  const charges = [
    <path key="0" d="M15 7 L18 14 L15 23 L12 14 Z" fill="#0a101c" />,
    <circle key="1" cx="15" cy="15" r="4.5" fill="none" stroke="#0a101c" strokeWidth="2" />,
    <path key="2" d="M9 17 L15 9 L21 17 Z" fill="#0a101c" />,
    <path key="3" d="M10 10 L20 20 M20 10 L10 20" stroke="#0a101c" strokeWidth="2.2" />,
    <rect key="4" x="11" y="11" width="8" height="8" fill="#0a101c" transform="rotate(45 15 15)" />,
    <path key="5" d="M9 15 H21 M15 9 V21" stroke="#0a101c" strokeWidth="2.4" />,
    <path key="6" d="M10 19 L10 12 L13 15 L15 10 L17 15 L20 12 L20 19 Z" fill="#0a101c" />,
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden style={{ flex: 'none' }}>
      <path d="M15 1 L29 15 L15 29 L1 15 Z" fill={c} />
      <path d="M15 3.5 L26.5 15 L15 26.5 L3.5 15 Z" fill="none" stroke="#0a101c" strokeOpacity="0.35" />
      {charges[empire.emblem % charges.length]}
    </svg>
  );
}

export function EmpireName({ empire, onClick }: { empire: Empire; onClick?: () => void }) {
  return (
    <span className="row" style={{ gap: 6, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <Swatch color={empire.color} />
      <span>{empire.name}</span>
    </span>
  );
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
