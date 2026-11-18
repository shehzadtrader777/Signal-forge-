import { useState } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { SideMenuDrawer } from './components/SideMenuDrawer';
import { GlobalAppLiveBar } from './components/GlobalAppLiveBar';
import { FloatingWhatsApp } from './components/FloatingWhatsApp';
import { FloatingTelegramChannel } from './components/FloatingTelegramChannel';
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

function AppShell() {
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const { forgeCapitalState } = useApp();
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
    <div className="min-h-screen flex flex-col bg-[#0a0e1a] text-slate-100">
      <Navbar onOpenSideMenu={() => setSideMenuOpen(true)} />
      <SideMenuDrawer open={sideMenuOpen} onClose={() => setSideMenuOpen(false)} />
      <GlobalAppLiveBar />

      <main className="flex-1 pb-12">
        <ErrorBoundary title="Dashboard View Recovery">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/signal-history" element={<SignalHistory />} />
            <Route path="/backtesting" element={<Backtesting />} />
            <Route path="/trust-console" element={<TrustConsole />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/auto-reports" element={<AutoReports />} />
            <Route path="/about" element={<About />} />
            <Route path="/login" element={<Auth />} />
          </Routes>
        </ErrorBoundary>
      </main>

      <footer className="border-t border-slate-800/80 bg-[#0d1323] py-6 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:pl-56 sm:pr-44 text-xs text-slate-400">
          <div>
            <span className="font-semibold text-white">Signal Forge</span>
            <span className="mx-2 text-slate-600" aria-hidden="true">
              ·
            </span>
            <span>Developed by Amir Shehzad</span>
            <span className="mx-2 text-slate-600" aria-hidden="true">
              ·
            </span>
            <a
              href="mailto:amirshehzad2647tcs@gmail.com"
              className="hover:text-white transition-colors"
            >
              amirshehzad2647tcs@gmail.com
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/portfolio" className="hover:text-white transition-colors">
              Portfolio
            </Link>
            <Link to="/signals" className="hover:text-white transition-colors">
              Signals
            </Link>
            <Link to="/auto-reports" className="hover:text-white transition-colors">
              Auto-Reports
            </Link>
            <Link to="/signal-history" className="hover:text-white transition-colors">
              Signal History
            </Link>
            <Link to="/backtesting" className="hover:text-white transition-colors">
              Backtesting
            </Link>
            <Link to="/trust-console" className="hover:text-white transition-colors">
              Trust Console
            </Link>
            <Link to="/alerts" className="hover:text-white transition-colors">
              Alerts
            </Link>
            <Link to="/about" className="hover:text-white transition-colors">
              About Us
            </Link>
            <a
              href="https://wa.me/923015083557"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
            >
              WhatsApp Desk
            </a>
          </div>
        </div>
      </footer>

      <FloatingTelegramChannel />
      <FloatingWhatsApp />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}
