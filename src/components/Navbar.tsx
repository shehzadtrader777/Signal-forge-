import { useMemo, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, Search, Settings as SettingsIcon, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { signOutUser } from '../lib/firebase';
import { useRbacIdentity } from '../hooks/useRbacIdentity';
import { useTradingArchitectureStore } from '../store/useTradingArchitectureStore';
import { NotificationCenter } from './NotificationCenter';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', requiresConsoleRbac: false },
  { to: '/portfolio', label: 'Portfolio', requiresConsoleRbac: false },
  { to: '/signals', label: 'Signals', requiresConsoleRbac: false },
  { to: '/signal-history', label: 'Signal History', requiresConsoleRbac: false },
  { to: '/backtesting', label: 'Backtesting', requiresConsoleRbac: false },
  { to: '/trust-console', label: 'Test Console', requiresConsoleRbac: true },
  { to: '/watchlist', label: 'Watchlist', requiresConsoleRbac: false },
  { to: '/alerts', label: 'Alerts', requiresConsoleRbac: false },
  { to: '/about', label: 'About Us', requiresConsoleRbac: false },
];

interface NavbarProps {
  onOpenSideMenu: () => void;
}

export function Navbar({ onOpenSideMenu }: NavbarProps) {
  const { user } = useApp();
  const { rbac } = useRbacIdentity();
  const setGlobalSearchOpen = useTradingArchitectureStore((s) => s.setGlobalSearchOpen);
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => !item.requiresConsoleRbac || rbac.canAccessTestConsole),
    [rbac.canAccessTestConsole]
  );

  const handleAuthAction = async () => {
    if (user) {
      await signOutUser();
      navigate('/');
    } else {
      navigate('/login');
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0a0e1a]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 lg:gap-5 px-4 py-3 sm:px-6 lg:px-8">
        {/* Zone 1: Menu Trigger + Brand Mark (SF + Chart Icon + Signal Forge) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="open-side-menu-btn"
            onClick={onOpenSideMenu}
            aria-label="Open Main Side Menu"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#3b82f6] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Menu className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
            <span className="hidden sm:inline">Menu</span>
          </button>

          <Link
            to="/"
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] rounded-md"
          >
            <img src="/signal-forge-mark.svg" alt="" width="34" height="34" className="h-8 w-8 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight text-white">
              Signal Forge
            </span>
          </Link>
        </div>

        {/* Zone 2: Top-level single-line navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-3 xl:gap-4 text-[13px] font-medium"
        >
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors duration-150 ${
                  isActive
                    ? 'border-cyan-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: Global Search, Settings Hub, Notification Center & Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="nav-global-search-btn"
            onClick={() => setGlobalSearchOpen(true)}
            aria-label="Open Global Search Panel (Cmd/Ctrl + K)"
            title="Global Search · Features, Trades & Trade IDs (⌘K)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111827] px-2.5 py-2 text-xs font-semibold text-slate-300 hover:border-cyan-500/50 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <Search className="h-3.5 w-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">Search</span>
            <kbd className="hidden xl:inline rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-400">
              ⌘K
            </kbd>
          </button>

          <NavLink
            to="/settings"
            data-testid="nav-settings-link"
            aria-label="Settings and Command Control Hub"
            title="Settings · Command & Control Hub"
            className={({ isActive }) =>
              `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                isActive
                  ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800 bg-[#111827] text-slate-300 hover:border-cyan-500/50 hover:text-white'
              }`
            }
          >
            <SettingsIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">Settings</span>
          </NavLink>

          <NotificationCenter />

          <button
            type="button"
            onClick={handleAuthAction}
            className="hidden lg:inline-flex items-center justify-center rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {user ? `Sign Out (${user.displayName?.split(' ')[0] || 'Trader'})` : 'Sign In'}
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            className="inline-flex lg:hidden items-center justify-center rounded-lg border border-slate-800 bg-[#111827] p-2 text-slate-200 hover:bg-slate-800"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile & Tablet Navigation Drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-[#0d1323] px-4 py-4 space-y-2">
          <nav className="flex flex-col gap-1" aria-label="Mobile Navigation">
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium ${
                    isActive
                      ? 'bg-[#3b82f6]/15 text-white'
                      : 'text-slate-300 hover:bg-slate-800/70'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
              <Link to="/welcome#guide" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800/70">Super Guide · Read only</Link>
              <Link to="/pricing" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800/70">Plans & Roadmap</Link>
              <NavLink
                to="/settings"
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-200'
                      : 'text-slate-300 hover:bg-slate-800/70'
                  }`
                }
              >
                Settings · Command Hub
              </NavLink>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setGlobalSearchOpen(true);
                }}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-cyan-300 hover:bg-slate-800/70"
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span>Global Search &amp; Trade IDs (⌘K)</span>
              </button>
          </nav>
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              handleAuthAction();
            }}
            className="mt-2 w-full rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            {user ? `Sign Out (${user.displayName || user.email})` : 'Sign In / Sign Up'}
          </button>
        </div>
      )}
    </header>
  );
}
