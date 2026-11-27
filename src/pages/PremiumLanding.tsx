import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, Blocks, ChartCandlestick, LockKeyhole, MoveRight, Palette, ShieldCheck, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';
import '../styles/neoPremium.css';
import { GuideOnlyAssistant } from '../components/GuideOnlyAssistant';

/** Public product preview. All cards illustrate capabilities, never fabricated P&L. */
export function PremiumLanding() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('signal-forge-public-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const changeTheme = (next: 'dark' | 'light') => {
    setTheme(next);
    try { localStorage.setItem('signal-forge-public-theme', next); } catch { /* storage unavailable */ }
  };
  return (
    <div className="neo-page" data-neo-theme={theme}>
      <div className="neo-container">
        <header className="neo-topbar" aria-label="Welcome navigation">
          <Link to="/welcome" className="neo-brand"><img src="/signal-forge-mark.svg" alt="" width="34" height="34" className="inline-block align-middle" /> Signal Forge</Link>
          <div className="neo-theme-switch" role="group" aria-label="Appearance"><button type="button" aria-pressed={theme === "dark"} onClick={() => changeTheme("dark")}>Dark Forge</button><button type="button" aria-pressed={theme === "light"} onClick={() => changeTheme("light")}>Light Forge</button></div>
          <nav className="neo-toplinks" aria-label="Landing links">
            <a href="#features">Features</a>
            <a href="#workspace">Workspace</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#guide">Super Guide</a>
            <Link className="neo-mobile-visible" to="/pricing">Plans</Link>
            <Link className="neo-pill" to="/login">Login</Link>
          </nav>
        </header>

        <main>
          <section className="neo-hero" aria-labelledby="neo-hero-title">
            <div className="neo-hero-copy">
              <p className="neo-eyebrow"><Sparkles size={15} aria-hidden="true" /> INTELLIGENT MARKET WORKSPACE</p>
              <h1 id="neo-hero-title">Read the market.<br /><span>Make clarity your edge.</span></h1>
              <p className="neo-lead">An organized home for verified signal analysis, thoughtful portfolio insights and transparent paper-to-demo trade comparison. Designed for clarity, not hype.</p>
              <div className="neo-cta-row">
                <Link to="/login?mode=signup" className="neo-btn neo-btn-primary">Get Started <MoveRight size={17} aria-hidden="true" /></Link>
                <Link to="/login" className="neo-btn neo-btn-secondary">Login <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
              <p className="neo-smallprint"><ShieldCheck size={15} aria-hidden="true" /> Paper-first by design. Live trading is locked until separately authorized and verified.</p>
            </div>
            <div className="neo-showcase" aria-label="Illustrative dashboard feature overview">
              <div className="neo-mini-label"><span className="neo-status-dot" /> WORKSPACE PREVIEW <span>Illustrative · No live account data</span></div>
              <div className="neo-preview-card">
                <div className="neo-preview-top"><div><p className="neo-eyebrow">AT A GLANCE</p><h2>Markets, organized.</h2></div><BarChart3 size={25} aria-hidden="true" /></div>
                <div className="neo-preview-metrics">
                  <div><p>Signals</p><strong>One unified view</strong><small>By confidence & strategy</small></div>
                  <div><p>Trading modes</p><strong>3 separate ledgers</strong><small>Paper · Demo · Live</small></div>
                </div>
                <div className="neo-preview-bars" aria-hidden="true"><i style={{height:'38%'}}/><i style={{height:'65%'}}/><i style={{height:'53%'}}/><i style={{height:'81%'}}/><i style={{height:'73%'}}/><i style={{height:'95%'}}/><i style={{height:'60%'}}/><i style={{height:'78%'}}/><i style={{height:'69%'}}/><i style={{height:'89%'}}/><i style={{height:'62%'}}/><i style={{height:'76%'}}/></div>
                <p className="neo-micro-note">Visual illustration only — no fabricated market prices or performance.</p>
              </div>
              <div className="neo-preview-bottom"><div><ChartCandlestick size={19} /> Smart charts</div><div><LockKeyhole size={19}/> Risk controls</div></div>
            </div>
          </section>

          <section id="features" className="neo-section" aria-labelledby="neo-feature-title">
            <div className="neo-section-heading"><p className="neo-eyebrow">DESIGNED AROUND YOU</p><h2 id="neo-feature-title">Everything important. Nothing in the way.</h2><p>Built for faster understanding, not more distracting panels.</p></div>
            <div className="neo-feature-grid">
              {[
                {icon: <Blocks size={23}/>,title:'Customizable widgets',text:'Arrange your market, signals and portfolio workspace around your own workflow.'},
                {icon: <Activity size={23}/>,title:'Clear market analytics',text:'Inspect data freshness, timeframe and provenance before acting on any signal.'},
                {icon: <Wallet size={23}/>,title:'Transparent portfolios',text:'Keep simulated, sandbox and real financial outcomes separate and clearly labeled.'},
                {icon: <SlidersHorizontal size={23}/>,title:'Signal quick view',text:'Open an in-page smart chart for each signal, with entry, stop and target context.'},
                {icon: <Palette size={23}/>,title:'Personal themes',text:'Choose refined, readable workspaces with soft depth and accessible contrast.'},
                {icon: <ShieldCheck size={23}/>,title:'Security first',text:'Verified authentication, protected data and safety gates take priority over automation.'},
              ].map(item => <article key={item.title} className="neo-feature-card"><span className="neo-feature-icon">{item.icon}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}
            </div>
          </section>

          <section id="roadmap" className="mx-auto max-w-6xl py-16 sm:py-24" aria-labelledby="roadmap-title">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-700">Product journey</p>
            <h2 id="roadmap-title" className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Built in clear, verifiable stages.</h2>
            <p className="mt-4 max-w-2xl text-slate-600">Planned capabilities are not presented as released features. Milestones advance only after review, security checks and testing.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                { step: '01', title: 'Premium foundation', detail: 'Landing experience, customizable workspaces and accessible navigation. Refinement and quality checks ongoing.', status: 'In development' },
                { step: '02', title: 'Guided research', detail: 'Smart chart workflows, clear signal explanations and read-only user education. AI-powered conversation requires separate integration.', status: 'In development' },
                { step: '03', title: 'Verified readiness', detail: 'Mode isolation, account-level authorization, security reviews and proof-backed release gates before any live operations.', status: 'Not released' },
              ].map(item => <article key={item.step} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className="text-xs font-bold tracking-wider text-blue-700">{item.step} · {item.status}</span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{item.detail}</p>
              </article>)}
            </div>
          </section>

          <GuideOnlyAssistant />

          <section id="workspace" className="neo-last-cta">
            <div><p className="neo-eyebrow">YOUR WORKSPACE. YOUR PACE.</p><h2>One place to see what matters.</h2><p>Build a personalized, paper-first market research workflow with transparent data and thoughtful controls.</p></div>
            <Link to="/login?mode=signup" className="neo-btn neo-btn-primary">Create your workspace <MoveRight size={17}/></Link>
          </section>
        </main>
        <footer className="neo-landing-footer"><span>© {new Date().getFullYear()} Signal Forge</span><span>Financial tools are informational; no performance is guaranteed.</span></footer>
      </div>
    </div>
  );
}
