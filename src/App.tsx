import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { SideMenuDrawer } from './components/SideMenuDrawer';
import { GlobalAppLiveBar } from './components/GlobalAppLiveBar';
import { LivePriceStrip } from './components/LivePriceStrip';
import { FloatingWidgetDock } from './components/FloatingWidgetDock';
import { MaintenanceBannerAndGate } from './components/MaintenanceBannerAndGate';
import {
  AnchoredSocialWidgets,
  GeminiCollaborationAttribution,
} from './components/FooterSocialAndContact';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PublicHome } from './pages/PublicHome';
import { useWorkspaceStore } from './store/useWorkspaceStore';
import { useRbacIdentity } from './hooks/useRbacIdentity';

// Lazy-load secondary & heavyweight workspaces to eliminate startup delays
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const Portfolio = lazy(() =>
  import('./pages/Portfolio').then((m) => ({ default: m.Portfolio }))
);
const Signals = lazy(() =>
  import('./pages/Signals').then((m) => ({ default: m.Signals }))
);
const SignalHistory = lazy(() =>
  import('./pages/SignalHistory').then((m) => ({ default: m.SignalHistory }))
);
const Backtesting = lazy(() =>
  import('./pages/Backtesting').then((m) => ({ default: m.Backtesting }))
);
const Watchlist = lazy(() =>
  import('./pages/Watchlist').then((m) => ({ default: m.Watchlist }))
);
const Alerts = lazy(() =>
  import('./pages/Alerts').then((m) => ({ default: m.Alerts }))
);
const AutoReports = lazy(() =>
  import('./pages/AutoReports').then((m) => ({ default: m.AutoReports }))
);
const About = lazy(() =>
  import('./pages/About').then((m) => ({ default: m.About }))
);
const Auth = lazy(() =>
  import('./pages/Auth').then((m) => ({ default: m.Auth }))
);
const TrustConsole = lazy(() =>
  import('./pages/TrustConsole').then((m) => ({ default: m.TrustConsole }))
);
const Settings = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings }))
);

function RouteLoadingFallback() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-16 text-center font-mono text-xs text-slate-400">
      Loading Signal Forge module...
    </div>
  );
}

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

/**
 * Predictable Route Scroll Manager:
 * - Scrolls to top (0, 0) ONLY on forward PUSH navigation when no hash anchor is targeted.
 * - Preserves browser scroll restoration on POP (Back / Forward) navigation.
 * - Scrolls smoothly to #hash elements when explicitly linked.
 */
function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (location.hash) {
      const targetId = location.hash.replace(/^#/, '');
      const timer = window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
      return () => window.clearTimeout(timer);
    }
    if (navigationType === 'PUSH') {
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      const rafId = window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      });
      return () => window.cancelAnimationFrame(rafId);
    }
  }, [location.pathname, location.hash, navigationType]);

  return null;
}

function AppShell() {
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const handleOpenSideMenu = useCallback(() => setSideMenuOpen(true), []);
  const handleCloseSideMenu = useCallback(() => setSideMenuOpen(false), []);
  const location = useLocation();
  const { forgeCapitalState, user } = useApp();
  const { rbac } = useRbacIdentity();
  const neonGridOverlay = useWorkspaceStore((s) => s.cyber.neonGridOverlay);
  const designVariant = useWorkspaceStore((s) => s.cyber.designVariant);
  const density = useWorkspaceStore((s) => s.cyber.density);
  const activeProfile = forgeCapitalState?.activeGuardProfile;
  const isPublicHomepage =
    location.pathname === '/home' || (location.pathname === '/' && !user);

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
      <Navbar onOpenSideMenu={handleOpenSideMenu} />
      <SideMenuDrawer open={sideMenuOpen} onClose={handleCloseSideMenu} />
      <RouteScrollManager />
      {!isPublicHomepage && <GlobalAppLiveBar />}
      <LivePriceStrip />

      <main className="flex-1 pb-24 sm:pb-20">
        <MaintenanceBannerAndGate>
          <ErrorBoundary title="Dashboard View Recovery">
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/" element={user ? <Dashboard /> : <PublicHome />} />
                <Route path="/home" element={<PublicHome />} />
                <Route path="/dashboard" element={<Dashboard />} />
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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </MaintenanceBannerAndGate>
      </main>

      {/* Streamlined Footer: ONLY "Developed by Amir Shehzad", "Co-developed with Gemini", and mandatory disclaimer */}
      <footer
        data-testid="app-footer"
        className="border-t border-slate-800/90 bg-[#050914] pt-6 pb-28 sm:pb-24 px-4 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-[1440px]">
          <GeminiCollaborationAttribution />
        </div>
      </footer>

      {/* Permanently Anchored Bottom-Left Circular Social Widgets (hidden cleanly while drawer is open) */}
      {!sideMenuOpen && <AnchoredSocialWidgets />}

      {/* Auth-Aware Bottom-Right Controls (hidden cleanly while drawer is open) */}
      {!sideMenuOpen && <FloatingWidgetDock isLoggedIn={Boolean(user)} userRole={rbac.role} />}
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
