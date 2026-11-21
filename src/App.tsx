import { useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { MessageCircle } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { SideMenuDrawer } from './components/SideMenuDrawer';
import { GlobalAppLiveBar } from './components/GlobalAppLiveBar';
import { LivePriceStrip } from './components/LivePriceStrip';
import { FloatingWidgetDock } from './components/FloatingWidgetDock';
import { FloatingTelegramChannel } from './components/FloatingTelegramChannel';
import {
  DedicatedEmailIconLink,
  FooterSocialIconsRow,
  GeminiCollaborationAttribution,
  WHATSAPP_DESK_URL,
} from './components/FooterSocialAndContact';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Signals } from './pages/Signals';
import { SignalHistory } from './pages/SignalHistory';
import { Backtesting } from './pages/Backtesting';
import { Watchlist } from './pages/Watchlist';
import { Alerts } from './pages/Alerts';
import { AutoReports } from './pages/AutoReports';
import { About } from './pages/About';
import { Auth } from './pages/Auth';
import { TrustConsole } from './pages/TrustConsole';
import { Settings } from './pages/Settings';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import { useRbacIdentity } from './hooks/useRbacIdentity';

function ProtectedConsoleRoute({ children }: { children: ReactNode }) {
  const { rbac, loading } = useRbacIdentity();
  if (loading) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 py-16 text-center font-mono text-xs text-cyan-300">
        Verifying RBAC clearance for Test Console...
      </div>
    );
  }
  if (!rbac.canAccessTestConsole) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppShell() {
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const { forgeCapitalState } = useApp();
  const { rbac } = useRbacIdentity();
  const neonGridOverlay = useWorkspaceStore((s) => s.cyber.neonGridOverlay);
  const designVariant = useWorkspaceStore((s) => s.cyber.designVariant);
  const density = useWorkspaceStore((s) => s.cyber.density);
  const activeProfile = forgeCapitalState?.activeGuardProfile;

  if (!activeProfile) {
    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center bg-[#0a0e1a] text-rose-200 p-6 font-mono text-sm"
      >
        [LAYER_2_PROFILE_RESOLUTION: UNRESOLVED_STARTUP_PROFILE] Startup profile failed closed.
      </div>
    );
  }

  return (
    <div
      data-design-variant={designVariant}
      data-widget-density={density}
      className={`min-h-screen flex flex-col text-slate-100 ${
        neonGridOverlay ? 'cyber-grid-backdrop' : 'bg-[var(--forge-canvas-bg)]'
      }`}
    >
      <Navbar onOpenSideMenu={() => setSideMenuOpen(true)} />
      <SideMenuDrawer open={sideMenuOpen} onClose={() => setSideMenuOpen(false)} />
      <GlobalAppLiveBar />
      <LivePriceStrip />

      <main className="flex-1 pb-10">
        <ErrorBoundary title="Dashboard View Recovery">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/signal-history" element={<SignalHistory />} />
            <Route path="/backtesting" element={<Backtesting />} />
            <Route
              path="/trust-console"
              element={
                <ProtectedConsoleRoute>
                  <TrustConsole />
                </ProtectedConsoleRoute>
              }
            />
            <Route
              path="/test-console"
              element={
                <ProtectedConsoleRoute>
                  <TrustConsole />
                </ProtectedConsoleRoute>
              }
            />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/auto-reports" element={<AutoReports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Auth />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {/* Pinned Sticky Footer Action Bar: Telegram + WhatsApp Widgets & Consolidated Bottom Voice Widget */}
      <div
        role="region"
        aria-label="Sticky Footer Communication & Voice Bar"
        data-testid="sticky-footer-bar"
        className="sticky bottom-0 z-40 border-t border-cyan-500/20"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[#070d1b]/95 backdrop-blur-md pointer-events-none"
        />
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <FloatingTelegramChannel />

            <a
              href={WHATSAPP_DESK_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chat on WhatsApp with Amir Shehzad"
              data-testid="sticky-footer-whatsapp-widget"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 shadow-sm shadow-emerald-950/50 hover:bg-emerald-400 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-emerald-300"
            >
              <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="text-left leading-tight">
                <span className="block font-display text-xs font-bold">WhatsApp</span>
                <span className="hidden md:block text-[10px] font-medium text-emerald-950/85">
                  Direct Desk
                </span>
              </span>
            </a>
          </div>

          <FloatingWidgetDock />
        </div>
      </div>

      {/* Main Footer: Brand + Dedicated Email Icon + Site Links + Bottom Social Media Icons Row */}
      <footer
        data-testid="app-footer"
        className="border-t border-slate-800/90 bg-[#050914] py-6 px-4 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-[1440px] space-y-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-display text-sm font-bold text-white">Signal Forge</span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>Developed by Amir Shahzad</span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <DedicatedEmailIconLink testId="footer-email-icon-link" />
            </div>

            <nav aria-label="Footer Navigation" className="flex flex-wrap items-center gap-4">
              <Link to="/portfolio" className="hover:text-white transition-colors whitespace-nowrap">
                Portfolio
              </Link>
              <Link to="/signals" className="hover:text-white transition-colors whitespace-nowrap">
                Signals
              </Link>
              <Link to="/auto-reports" className="hover:text-white transition-colors whitespace-nowrap">
                Auto-Reports
              </Link>
              <Link to="/signal-history" className="hover:text-white transition-colors whitespace-nowrap">
                Signal History
              </Link>
              <Link to="/backtesting" className="hover:text-white transition-colors whitespace-nowrap">
                Backtesting
              </Link>
              <Link to="/settings" className="hover:text-white transition-colors whitespace-nowrap">
                Settings
              </Link>
              {rbac.canAccessTestConsole && (
                <Link to="/trust-console" className="hover:text-white transition-colors whitespace-nowrap">
                  Test Console
                </Link>
              )}
              <Link to="/alerts" className="hover:text-white transition-colors whitespace-nowrap">
                Alerts
              </Link>
              <Link to="/about" className="hover:text-white transition-colors whitespace-nowrap">
                About Us
              </Link>
            </nav>
          </div>

          <div className="flex flex-col gap-4 border-t border-slate-800/80 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-3xl">
                <GeminiCollaborationAttribution />
              </div>
              <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                <FooterSocialIconsRow />
                <p className="text-[11px] text-slate-500">
                  &copy; {new Date().getFullYear()} Signal Forge. All rights reserved.
                </p>
              </div>
            </div>
          </div>
        </div>
      </footer>

      <GlobalSearchModal />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}
