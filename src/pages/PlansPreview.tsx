import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import '../styles/neoPremium.css';

/** Public plan information only. No checkout, fictional prices, or entitlement claims. */
export function PlansPreview() {
  const features = [
    { title: 'Explore', subtitle: 'Discover the workspace', points: ['Public feature overview', 'Platform safety explanations', 'Read-only Super Guide'] },
    { title: 'Research workspace', subtitle: 'Plan details under review', points: ['Customizable research views', 'Signal and chart exploration', 'Transparent simulated-mode labels'] },
    { title: 'Advanced workspace', subtitle: 'Not yet available for purchase', points: ['Additional tools subject to testing', 'Account-scoped controls', 'Separate verified release requirements'] },
  ] as const;
  return (
    <div className="neo-page" data-neo-theme="stone">
      <div className="neo-container">
        <header className="neo-topbar" aria-label="Plans navigation">
          <Link to="/welcome" className="neo-brand"><span className="neo-brand-symbol">SF</span> Signal Forge</Link>
          <nav className="neo-toplinks" aria-label="Plans links">
            <Link to="/welcome">Overview</Link>
            <Link to="/welcome#roadmap">Roadmap</Link>
            <Link to="/login" className="neo-pill">Login</Link>
          </nav>
        </header>
        <main className="pb-20">
          <section className="mx-auto max-w-3xl py-16 text-center sm:py-24">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-700"><Sparkles size={16}/> Transparent access</p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">A workspace that grows with you.</h1>
            <p className="mt-5 text-base leading-8 text-slate-600">We are preparing a clear plan structure. Prices, paid entitlements, trials, credit allowances and launch dates have not been approved. Nothing here initiates a purchase.</p>
          </section>
          <section className="grid gap-5 md:grid-cols-3" aria-label="Planned access categories">
            {features.map((plan, index) => (
              <article key={plan.title} className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <span className="text-xs font-bold uppercase tracking-widest text-blue-700">{index === 0 ? 'Public overview' : 'Planned · Not for sale'}</span>
                <h2 className="mt-4 text-2xl font-bold text-slate-900">{plan.title}</h2>
                <p className="mt-2 text-sm text-slate-600">{plan.subtitle}</p>
                <p className="mt-6 border-b border-slate-200 pb-5 text-2xl font-bold text-slate-900">{index === 0 ? 'Explore features' : 'Pricing pending'}</p>
                <ul className="mt-5 flex-1 space-y-4">
                  {plan.points.map(point => <li className="flex items-start gap-3 text-sm leading-6 text-slate-700" key={point}><CheckCircle2 className="mt-0.5 shrink-0 text-blue-600" size={17}/>{point}</li>)}
                </ul>
                <Link to={index === 0 ? '/welcome' : '/welcome#roadmap'} className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700">
                  {index === 0 ? 'Explore Signal Forge' : 'View roadmap'} <ArrowRight size={16}/>
                </Link>
              </article>
            ))}
          </section>
          <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-3 text-slate-900"><ShieldCheck size={23}/><h2 className="text-lg font-bold">Important release safeguards</h2></div>
            <p className="mt-3 text-sm leading-7 text-slate-600">Research features do not guarantee trading returns. Paper, demo and live environments require separate verified controls. No subscription purchase, credit charge, external exchange action or live-trading unlock is connected to this page.</p>
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600"><LockKeyhole size={15}/> No payment information is collected here.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
