import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { signOutUser } from '../lib/firebase';
import { NotificationCenter } from './NotificationCenter';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/signals', label: 'Signals' },
  { to: '/signal-history', label: 'Signal History' },
  { to: '/backtesting', label: 'Backtesting' },
  { to: '/trust-console', label: 'Trust Console' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/about', label: 'About Us' },
];

interface NavbarProps {
  onOpenSideMenu: () => void;
}

export function Navbar({ onOpenSideMenu }: NavbarProps) {
  const { user } = useApp();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

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

        {/* Zone 2: Top-level single-line navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-3 xl:gap-4 text-[13px] font-medium"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors duration-150 ${
                  isActive
                    ? 'border-[#3b82f6] text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-slate-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: Notification Center & Primary Action */}
        <div className="flex items-center gap-2.5 shrink-0">
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
            {NAV_ITEMS.map((item) => (
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
