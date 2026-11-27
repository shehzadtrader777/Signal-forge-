import { useMemo } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { signOutUser } from '../lib/firebase';
import { useRbacIdentity } from '../hooks/useRbacIdentity';
import { NotificationCenter } from './NotificationCenter';

const PUBLIC_NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/dashboard', label: 'Workspace', end: false },
  { to: '/signals', label: 'Signals', end: false },
  { to: '/signal-history', label: 'Trade History', end: false },
  { to: '/about', label: 'About', end: false },
];

const SIGNED_IN_NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, requiresConsoleRbac: false },
  { to: '/home', label: 'Public Site', end: false, requiresConsoleRbac: false },
  { to: '/portfolio', label: 'Portfolio', end: false, requiresConsoleRbac: false },
  { to: '/signals', label: 'Signals', end: false, requiresConsoleRbac: false },
  { to: '/signal-history', label: 'History', end: false, requiresConsoleRbac: false },
  { to: '/backtesting', label: 'Backtesting', end: false, requiresConsoleRbac: false },
  { to: '/trust-console', label: 'Test Console', end: false, requiresConsoleRbac: true },
  { to: '/alerts', label: 'Alerts', end: false, requiresConsoleRbac: false },
];

interface NavbarProps {
  onOpenSideMenu: () => void;
}

export function Navbar({ onOpenSideMenu }: NavbarProps) {
  const { user } = useApp();
  const { rbac } = useRbacIdentity();
  const navigate = useNavigate();

  const visibleNavItems = useMemo(() => {
    if (!user) return PUBLIC_NAV_ITEMS;
    return SIGNED_IN_NAV_ITEMS.filter(
      (item) => !item.requiresConsoleRbac || rbac.canAccessTestConsole
    );
  }, [user, rbac.canAccessTestConsole]);

  const handleAuthAction = async () => {
    if (user) {
      await signOutUser();
      navigate('/');
    } else {
      navigate('/login');
    }
  };

  return (
    <header
      data-testid="app-navbar"
      className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0a0e1a]/95 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 lg:gap-8 px-4 py-3 sm:px-6 lg:px-8">
        {/* Zone 1: Menu Trigger + Brand Mark */}
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
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b82f6] text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 17l5-5 4 3 8-8" />
                <path d="M16 7h4v4" />
              </svg>
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              <span className="text-[#3b82f6] mr-1.5">SF</span>Signal Forge
            </span>
          </Link>
        </div>

        {/* Zone 2: Clean Public or Signed-In Navigation Links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-5 text-[13px] font-medium"
        >
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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

        {/* Zone 3: Notification Center & Primary Auth Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          {user && <NotificationCenter />}

          <button
            type="button"
            onClick={handleAuthAction}
            data-testid="nav-auth-btn"
            className="inline-flex items-center justify-center rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {user ? `Sign Out (${user.displayName?.split(' ')[0] || 'Trader'})` : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
}
