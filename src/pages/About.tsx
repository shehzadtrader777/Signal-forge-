import { useState } from 'react';
import { Mail, MessageCircle, ShieldCheck } from 'lucide-react';
import { DedicatedEmailIconLink, CONTACT_EMAIL_ADDRESS } from '../components/FooterSocialAndContact';
import founderPortrait from '../assets/images/founder_amir_shehzad_1794687451706.jpg';

export function About() {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8 space-y-10">
      {/* Hero Profile Split */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-stretch rounded-xl border border-slate-800/90 bg-[#111827] overflow-hidden">
        <div className="lg:col-span-5 bg-[#0d1323] flex items-center justify-center">
          {!imgError ? (
            <img
              src={founderPortrait}
              alt="Amir Shehzad — Founder and Lead Architect of Signal Forge"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="h-full max-h-[420px] w-full object-cover"
            />
          ) : (
            <div className="flex h-72 w-full flex-col items-center justify-center bg-gradient-to-br from-[#0d1323] to-[#1e293b] p-6 text-center">
              <span className="font-display text-4xl font-bold text-[#3b82f6]">AS</span>
              <span className="mt-2 text-sm font-medium text-slate-300">Amir Shehzad</span>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center space-y-5">
          <div>
            <span className="text-xs font-medium text-[#3b82f6]">
              About Signal Forge
            </span>
            <h1 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Developed by Amir Shehzad
            </h1>
            <p className="mt-3 text-sm sm:text-base leading-relaxed text-slate-300">
              Signal Forge is an automated cryptocurrency intelligence platform built to unify
              real-time Binance market structure, multi-factor technical indicators, CryptoPanic
              fundamental catalysts, CoinMarketCap whale netflow monitoring, LunarCrush social
              sentiment, and strict position-size risk management in one unified terminal.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-y border-slate-800 py-4 text-xs">
            <div>
              <span className="text-slate-400">Owner &amp; Lead Developer</span>
              <p className="mt-0.5 text-sm font-semibold text-white">Amir Shehzad</p>
            </div>
            <div>
              <span className="text-slate-400">Direct Support</span>
              <div className="mt-1 flex items-center gap-2">
                <DedicatedEmailIconLink testId="about-email-icon-link" />
                <span className="text-xs text-slate-300">Direct Email Desk</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://wa.me/923015083557"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              <span>Message on WhatsApp</span>
            </a>

            <a
              href={`mailto:${CONTACT_EMAIL_ADDRESS}`}
              aria-label="Send email to Amir Shehzad"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0d1323] px-5 py-2.5 text-xs font-semibold text-white hover:border-[#3b82f6] transition-colors whitespace-nowrap"
            >
              <Mail className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
              <span>Send Email</span>
            </a>
          </div>
        </div>
      </section>

      {/* Core Methodology */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-6 space-y-2">
          <h2 className="font-display text-lg font-bold text-white">
            01. Dual-Agent Signal Synthesis
          </h2>
          <p className="text-xs leading-relaxed text-slate-400">
            Combines quantitative technical telemetry (RSI 14, EMA 9/21/50 alignment, MACD
            histogram, Bollinger Band %B, and candlestick patterns) with CryptoPanic news sentiment
            to rank the Top 3 strongest market setups.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-6 space-y-2">
          <h2 className="font-display text-lg font-bold text-white">
            02. Whale &amp; Crowd Intelligence
          </h2>
          <p className="text-xs leading-relaxed text-slate-400">
            Tracks large exchange inflows and outflows alongside social volume and bullish vs
            bearish ratios so traders confirm institutional accumulation before entering a position.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#111827] p-6 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#3b82f6]" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-white">
              03. Disciplined Risk Sizing
            </h2>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            Every signal includes an instant Risk Management Calculator enforcing fixed percentage
            account risk, exact lot size calculation, and 30-day strategy backtesting.
          </p>
        </div>
      </section>
    </div>
  );
}
