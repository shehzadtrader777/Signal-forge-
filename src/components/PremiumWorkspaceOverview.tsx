import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartCandlestick, LayoutGrid, Palette, ShieldCheck, WalletCards, Workflow, BellRing } from 'lucide-react';
import '../styles/neoWorkspace.css';

type PremiumTheme = 'stone' | 'sage' | 'sand';
type TileId = 'signals' | 'portfolio' | 'history' | 'alerts';
const TILES: ReadonlyArray<{ id: TileId; label: string; path: string; description: string }> = [
  { id: 'signals', label: 'Unified Signals', path: '/signals', description: 'Review filtered strategies' },
  { id: 'portfolio', label: 'Portfolio', path: '/portfolio', description: 'Inspect verified balances' },
  { id: 'history', label: 'Trading History', path: '/signal-history', description: 'Explore signal outcomes' },
  { id: 'alerts', label: 'Notifications', path: '/alerts', description: 'Check delivery status' },
];
const ORDER_KEY = 'sf_premium_tile_order_v1';
const THEME_KEY = 'sf_premium_theme_v1';
function safeRead(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); } catch { return null; }
}
function safeSave(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private browsing may disable storage */ }
}
function initialOrder(): TileId[] {
  try {
    const raw = safeRead(ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length === TILES.length &&
      new Set(parsed).size === TILES.length &&
      parsed.every(id => TILES.some(tile => tile.id === id))) return parsed as TileId[];
  } catch { /* ignore corrupt local settings */ }
  return TILES.map(tile => tile.id);
}
function initialTheme(): PremiumTheme {
  const raw = safeRead(THEME_KEY);
  return raw === 'sage' || raw === 'sand' ? raw : 'stone';
}

/** Purely presentational user-owned dashboard shortcuts; no trading/financial mutations. */
export function PremiumWorkspaceOverview() {
  const [theme, setTheme] = useState<PremiumTheme>(initialTheme);
  const [order, setOrder] = useState<TileId[]>(initialOrder);
  const [editing, setEditing] = useState(false);
  useEffect(() => safeSave(THEME_KEY, theme), [theme]);
  useEffect(() => safeSave(ORDER_KEY, JSON.stringify(order)), [order]);
  const move = (index: number, step: number) => {
    setOrder(current => {
      const next = [...current];
      const target = index + step;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const icons = { signals: ChartCandlestick, portfolio: WalletCards, history: Workflow, alerts: BellRing };
  return <section className="neo-workspace" data-neo-workspace-theme={theme} aria-label="Premium personal workspace">
    <div className="neo-workspace-head">
      <div><p className="neo-workspace-eyebrow"><LayoutGrid size={15}/> PERSONAL WORKSPACE</p>
      <h2>One dashboard. Your perspective.</h2>
      <p>A clear starting point for signals, portfolio and alerts. No demo profits disguised as verified balances.</p></div>
      <div className="neo-workspace-controls">
        <label htmlFor="neo-theme"><Palette size={15}/> Theme</label>
        <select id="neo-theme" value={theme} onChange={e => setTheme(e.target.value as PremiumTheme)}>
          <option value="stone">Soft Stone</option><option value="sage">Sage Green</option><option value="sand">Warm Sand</option>
        </select>
        <button type="button" onClick={() => setEditing(v => !v)} aria-pressed={editing}>
          {editing ? 'Done' : 'Arrange cards'}
        </button>
      </div>
    </div>
    <div className="neo-workspace-grid">
      {order.map((id, index) => {
        const tile = TILES.find(t => t.id === id)!;
        const Icon = icons[id];
        return <article className="neo-workspace-tile" key={id}>
          <span className="neo-workspace-icon"><Icon size={20} aria-hidden="true"/></span>
          <div><h3>{tile.label}</h3><p>{tile.description}</p></div>
          {editing ? <div className="neo-workspace-movers">
            <button type="button" disabled={index === 0} aria-label={`Move ${tile.label} earlier`} onClick={() => move(index,-1)}>←</button>
            <button type="button" disabled={index === order.length - 1} aria-label={`Move ${tile.label} later`} onClick={() => move(index,1)}>→</button>
          </div> : <Link to={tile.path} className="neo-workspace-link" aria-label={`Open ${tile.label}`}>Open ↗</Link>}
        </article>;
      })}
    </div>
    <p className="neo-workspace-foot"><ShieldCheck size={15}/> Theme and card order save on this device only; sensitive account records are never stored here.</p>
  </section>;
}
export default PremiumWorkspaceOverview;
