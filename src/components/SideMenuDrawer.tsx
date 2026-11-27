import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
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
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useRbacIdentity } from '../hooks/useRbacIdentity';
import { evaluateCommandControlSnapshot } from '../lib/commandControlHub';
import { useCommandControlStore } from '../store/useCommandControlStore';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import { MOTION_120HZ_SPRINGS } from '../lib/designSystem';
import { LiveSwitchSecurityModal } from './LiveSwitchSecurityModal';

interface SideMenuDrawerProps {
  open: boolean;
  onClose: () => void;
}

const MENU_ROUTES = [
  { to: '/home', label: 'Public Platform Home', icon: Info, end: false, requiresConsoleRbac: false },
  { to: '/dashboard', label: 'Master Dashboard', icon: LayoutDashboard, end: false, requiresConsoleRbac: false },
  { to: '/signals', label: 'Coordinator & Execution', icon: Radio, end: false, requiresConsoleRbac: false },
  { to: '/portfolio', label: 'Multi-Asset Portfolio', icon: PieChart, end: false, requiresConsoleRbac: false },
  { to: '/auto-reports', label: 'Auto-Reports (D / W / M)', icon: FileBarChart2, end: false, requiresConsoleRbac: false },
  { to: '/signal-history', label: 'Signal History Audit', icon: History, end: false, requiresConsoleRbac: false },
  { to: '/backtesting', label: '30/60/90d Backtesting', icon: CalendarClock, end: false, requiresConsoleRbac: false },
  { to: '/trust-console', label: 'PG_v4 Test Console', icon: ShieldCheck, end: false, requiresConsoleRbac: true },
  { to: '/watchlist', label: 'Priority Watchlist', icon: Bookmark, end: false, requiresConsoleRbac: false },
  { to: '/alerts', label: 'Price Alerts Desk', icon: Bell, end: false, requiresConsoleRbac: false },
  { to: '/settings', label: 'Settings · Command Hub', icon: SlidersHorizontal, end: false, requiresConsoleRbac: false },
  { to: '/about', label: 'System Architecture', icon: Info, end: false, requiresConsoleRbac: false },
];

const SIDE_MENU_BACKDROP_INITIAL = { opacity: 0 } as const;
const SIDE_MENU_BACKDROP_ANIMATE = { opacity: 1 } as const;
const SIDE_MENU_BACKDROP_EXIT = { opacity: 0 } as const;
const SIDE_MENU_BACKDROP_TRANSITION = { duration: 0.18 } as const;

const SIDE_MENU_PANEL_INITIAL = { x: '-100%' } as const;
const SIDE_MENU_PANEL_ANIMATE = { x: 0 } as const;
const SIDE_MENU_PANEL_EXIT = { x: '-100%' } as const;
const SIDE_MENU_PANEL_TRANSITION = MOTION_120HZ_SPRINGS.drawer;

export function SideMenuDrawer({ open, onClose }: SideMenuDrawerProps) {
  const {
    executionState,
    hasSwitchedLiveOnce,
    switchExecutionMode,
    unifiedCapitalLedger,
  } = useApp();
  const { rbac } = useRbacIdentity();
  const hub = useCommandControlStore((s) => s.hub);
  const setGlobalOverride = useCommandControlStore((s) => s.setGlobalOverride);
  const setGranularToggle = useCommandControlStore((s) => s.setGranularToggle);
  const setVoiceOverlayOpen = useCommandControlStore((s) => s.setVoiceOverlayOpen);
  const executionControlMode = useTradingArchitectureStore((s) => s.executionMode);
  const setExecutionControlMode = useTradingArchitectureStore((s) => s.setExecutionMode);
  const [liveModalOpen, setLiveModalOpen] = useState(false);
  const [liveFeedback, setLiveFeedback] = useState<string | null>(null);
  const [controlPanelExpanded, setControlPanelExpanded] = useState(true);

  const hubSnapshot = useMemo(() => evaluateCommandControlSnapshot(hub), [hub]);

  const visibleMenuRoutes = useMemo(
    () => MENU_ROUTES.filter((item) => !item.requiresConsoleRbac || rbac.canAccessTestConsole),
    [rbac.canAccessTestConsole]
  );

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKey);
    };
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
      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-50 flex"
            role="dialog"
            aria-modal="true"
            aria-label="Signal Forge Main Menu"
            data-testid="side-menu-drawer"
          >
            {/* Backdrop */}
            <motion.div
              initial={SIDE_MENU_BACKDROP_INITIAL}
              animate={SIDE_MENU_BACKDROP_ANIMATE}
              exit={SIDE_MENU_BACKDROP_EXIT}
              transition={SIDE_MENU_BACKDROP_TRANSITION}
              className="fixed inset-0 bg-[#030712]/80"
              onClick={onClose}
              aria-hidden="true"
            />

            {/* Slide-Out Side Menu Container (touch-scroll safe; closed via backdrop, close button, or Escape) */}
            <motion.aside
              initial={SIDE_MENU_PANEL_INITIAL}
              animate={SIDE_MENU_PANEL_ANIMATE}
              exit={SIDE_MENU_PANEL_EXIT}
              transition={SIDE_MENU_PANEL_TRANSITION}
              className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-cyan-500/20 bg-[#070d1b] text-slate-100 shadow-2xl overscroll-contain"
            >
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
                    {rbac.canAccessTestConsole
                      ? `Owner Hub · ${rbac.role}`
                      : 'Paper/Demo Safe Navigation'}
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

            {/* Navigation Links & Comprehensive Main Menu Control Panel */}
            <nav
              aria-label="Side Menu Views"
              className="flex-1 overflow-y-auto px-3 py-4 space-y-1"
            >
              <button
                type="button"
                data-testid="side-menu-global-search-btn"
                onClick={() => {
                  onClose();
                  setVoiceOverlayOpen(true);
                }}
                className="mb-3 flex w-full items-center justify-between rounded-lg border border-[#F0B90B]/35 bg-[#F0B90B]/10 px-3 py-2 text-xs font-semibold text-[#FCD535] hover:bg-[#F0B90B]/20 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-[#F0B90B]" aria-hidden="true" />
                  <span>AI Hub &amp; Trade ID Lookup</span>
                </span>
                <kbd className="rounded border border-[#F0B90B]/30 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-[#F0B90B]">
                  ⌘K
                </kbd>
              </button>

              <div className="px-2 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Workspaces &amp; Reporting
              </div>
              {visibleMenuRoutes.map((item) => {
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

              {/* Comprehensive Main Menu Feature Control Panel */}
              <div
                data-testid="side-menu-control-panel"
                className="mt-4 pt-4 border-t border-slate-800/90 space-y-2.5"
              >
                <button
                  type="button"
                  onClick={() => setControlPanelExpanded((v) => !v)}
                  aria-expanded={controlPanelExpanded}
                  className="flex w-full items-center justify-between px-2 text-left cursor-pointer"
                >
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold">
                    Feature Control Panel
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">
                    {hubSnapshot.effectiveActiveCount}/{hubSnapshot.totalModules} ON
                  </span>
                </button>

                {controlPanelExpanded && (
                  <div className="space-y-2.5 px-1">
                    {/* Execution Mode Quick Toggle */}
                    <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-2.5 space-y-1.5">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        Master Execution Control
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          data-testid="side-menu-mode-autonomous"
                          onClick={() => setExecutionControlMode('FULLY_AUTONOMOUS')}
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                            executionControlMode === 'FULLY_AUTONOMOUS'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                          }`}
                        >
                          Autonomous
                        </button>
                        <button
                          type="button"
                          data-testid="side-menu-mode-supervised"
                          onClick={() => setExecutionControlMode('SUPERVISED_MANUAL_OVERRIDE')}
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                            executionControlMode === 'SUPERVISED_MANUAL_OVERRIDE'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                          }`}
                        >
                          Supervised
                        </button>
                      </div>
                    </div>

                    {/* Global Master Override */}
                    <div className="rounded-lg border border-slate-800 bg-[#0a0e1a] p-2.5 space-y-1.5">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                        Master Override
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            ['GRANULAR', 'Granular'],
                            ['FORCE_ALL_ON', 'All ON'],
                            ['FORCE_ALL_OFF', 'All OFF'],
                          ] as const
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setGlobalOverride(mode)}
                            className={`rounded-md px-1.5 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                              hub.globalOverride === mode
                                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Granular Feature Toggles */}
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                      {hubSnapshot.modules.map((mod) => (
                        <div
                          key={mod.descriptor.id}
                          className="flex items-center justify-between gap-2 rounded-md border border-slate-800/80 bg-[#0b1224] px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-200">
                              {mod.descriptor.label}
                            </div>
                            <div className="text-[9px] font-mono text-slate-500 truncate">
                              {mod.descriptor.domain} · {mod.isOverridden ? mod.resolution : 'GRANULAR'}
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={mod.effectiveEnabled}
                            aria-label={`Toggle ${mod.descriptor.label}`}
                            data-testid={`side-menu-toggle-${mod.descriptor.id}`}
                            onClick={() =>
                              setGranularToggle(mod.descriptor.id, !mod.granularEnabled)
                            }
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                              mod.effectiveEnabled
                                ? 'border-emerald-400/60 bg-emerald-500/30'
                                : 'border-slate-700 bg-slate-800'
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                                mod.effectiveEnabled
                                  ? 'translate-x-4 bg-emerald-300'
                                  : 'translate-x-0.5 bg-slate-400'
                              }`}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

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
