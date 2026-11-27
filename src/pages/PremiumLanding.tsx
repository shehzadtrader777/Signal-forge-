import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, Blocks, ChartCandlestick, LockKeyhole, MoveRight, Palette, ShieldCheck, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';
import '../styles/neoPremium.css';

/** Public product preview. All cards illustrate capabilities, never fabricated P&L. */
export function PremiumLanding() {
  return (
    <div className="neo-page" data-neo-theme="stone">
      <div className="neo-container">
        <header className="neo-topbar" aria-label="Welcome navigation">
          <Link to="/welcome" className="neo-brand"><span className="neo-brand-symbol">SF</span> Signal Forge</Link>
          <nav className="neo-toplinks" aria-label="Landing links">
            <a href="#features">Features</a>
            <a href="#workspace">Workspace</a>
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
