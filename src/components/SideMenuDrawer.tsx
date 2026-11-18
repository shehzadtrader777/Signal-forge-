import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Bell,
  Bookmark,
  CalendarClock,
  FileBarChart2,
  FlaskConical,
  History,
  Info,
  LayoutDashboard,
  PieChart,
  Radio,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { LiveSwitchSecurityModal } from './LiveSwitchSecurityModal';

interface SideMenuDrawerProps {
  open: boolean;
  onClose: () => void;
}

const MENU_ROUTES = [
  { to: '/', label: 'Master Dashboard', icon: LayoutDashboard, end: true },
  { to: '/signals', label: 'Coordinator & Execution', icon: Radio, end: false },
  { to: '/portfolio', label: 'Multi-Asset Portfolio', icon: PieChart, end: false },
  { to: '/auto-reports', label: 'Auto-Reports (D / W / M)', icon: FileBarChart2, end: false },
  { to: '/signal-history', label: 'Signal History Audit', icon: History, end: false },
  { to: '/backtesting', label: '30/60/90d Backtesting', icon: CalendarClock, end: false },
  { to: '/trust-console', label: 'PG_v4 Trust Console', icon: ShieldCheck, end: false },
  { to: '/watchlist', label: 'Priority Watchlist', icon: Bookmark, end: false },
  { to: '/alerts', label: 'Price Alerts Desk', icon: Bell, end: false },
  { to: '/about', label: 'System Architecture', icon: Info, end: false },
];

export function SideMenuDrawer({ open, onClose }: SideMenuDrawerProps) {
  const {
    executionState,
    hasSwitchedLiveOnce,
    switchExecutionMode,
    unifiedCapitalLedger,
  } = useApp();
  const [liveModalOpen, setLiveModalOpen] = useState(false);
  const [liveFeedback, setLiveFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const isLive = executionState.mode === 'LIVE';
  const liveButtonLabel = isLive
    ? 'Switch to Testnet'
    : hasSwitchedLiveOnce
    ? 'Back to Live'
    : 'Switch to Live';

  const handleToggleEnvironment = () => {
    setLiveFeedback(null);
    if (isLive) {
      switchExecutionMode('TESTNET');
      setLiveFeedback('Returned cleanly to Binance TESTNET Sandbox.');
    } else {
      setLiveModalOpen(true);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Signal Forge Main Menu"
          data-testid="side-menu-drawer"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Slide-Out Side Menu Container */}
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-[#0d1323] text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#3b82f6] text-xs font-bold text-white">
                  SF
                </span>
                <div>
                  <div className="font-display text-sm font-bold text-white leading-none">
                    Signal Forge Menu
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-slate-400">
                    Administration &amp; Routing
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close main menu"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Navigation Links */}
            <nav
              aria-label="Side Menu Views"
              className="flex-1 overflow-y-auto px-3 py-4 space-y-1"
            >
              <div className="px-2 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Workspaces &amp; Reporting
              </div>
              {MENU_ROUTES.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[#3b82f6]/15 text-white border border-[#3b82f6]/40'
                          : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0 text-[#3b82f6]" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {/* Exclusive Live / Testnet Mode Control Container */}
            <div
              data-testid="side-menu-live-control"
              className="border-t border-slate-800 bg-[#0a0e1a] p-4 space-y-3"
            >
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400 uppercase tracking-wider">
                  Execution Environment
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    isLive ? 'text-amber-300' : 'text-emerald-400'
                  }`}
                >
                  {isLive ? (
                    <Activity className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <FlaskConical className="h-3 w-3" aria-hidden="true" />
                  )}
                  {executionState.mode}
                </span>
              </div>

              <div className="rounded-lg border border-slate-800/90 bg-[#111827] px-3 py-2 text-[11px] font-mono tabular-nums space-y-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Equity Parity</span>
                  <span className="text-emerald-400 font-semibold">
                    {unifiedCapitalLedger.walletParityDivergencePct.toFixed(2)}% Drift
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {executionState.endpoint}
                </div>
              </div>

              {liveFeedback && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
                  {liveFeedback}
                </div>
              )}

              <button
                type="button"
                data-testid="exclusive-live-toggle-btn"
                onClick={handleToggleEnvironment}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  isLive
                    ? 'border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{liveButtonLabel}</span>
              </button>

              {isLive ? (
                <button
                  type="button"
                  onClick={() => switchExecutionMode('TESTNET')}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#111827] px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Return to Safe Testnet</span>
                </button>
              ) : (
                <p className="text-[10px] leading-snug text-slate-500">
                  Switching to Live execution requires Email OTP &amp; intent security verification.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      <LiveSwitchSecurityModal
        open={liveModalOpen}
        onClose={() => setLiveModalOpen(false)}
        onSuccess={() =>
          setLiveFeedback('LIVE execution authorized cleanly via Email OTP.')
        }
      />
    </>
  );
}
