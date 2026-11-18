import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { TRACKED_COINS, formatCryptoPrice } from '../lib/marketData';
import { SentimentMeter } from '../components/SentimentMeter';

export function Watchlist() {
  const { user, watchlist, toggleWatchlist, tickers, setSelectedSymbol } = useApp();
  const [coinToAdd, setCoinToAdd] = useState('LINKUSDT');
  const navigate = useNavigate();

  const availableToAdd = TRACKED_COINS.filter((c) => !watchlist.includes(c.symbol));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coinToAdd) return;
    if (!watchlist.includes(coinToAdd)) {
      await toggleWatchlist(coinToAdd);
    }
    const nextAvail = TRACKED_COINS.find(
      (c) => c.symbol !== coinToAdd && !watchlist.includes(c.symbol)
    );
    if (nextAvail) setCoinToAdd(nextAvail.symbol);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-800/80 pb-6">
        <div>
          <span className="text-xs text-slate-400">
            {user && user.emailVerified
              ? `Cloud Synced · ${user.email}`
              : 'Local Watchlist (Sign in with Google for cross-device Firestore sync)'}
          </span>
          <h1 className="mt-1 font-display text-3xl font-bold text-white tracking-tight">
            Trader Watchlist
          </h1>
        </div>

        {availableToAdd.length > 0 && (
          <form onSubmit={handleAdd} className="flex items-center gap-2">
            <label htmlFor="watchlist-add-select" className="sr-only">
              Select coin to add to watchlist
            </label>
            <select
              id="watchlist-add-select"
              value={availableToAdd.some((c) => c.symbol === coinToAdd) ? coinToAdd : availableToAdd[0].symbol}
              onChange={(e) => setCoinToAdd(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-xs font-medium text-white focus:border-[#3b82f6] focus:outline-none"
            >
              {availableToAdd.map((coin) => (
                <option key={coin.symbol} value={coin.symbol}>
                  {coin.name} ({coin.symbol})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3b82f6] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Coin</span>
            </button>
          </form>
        )}
      </div>

      {watchlist.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-10 text-center">
          <p className="text-sm text-slate-300">Your watchlist is currently empty.</p>
          <p className="mt-1 text-xs text-slate-400">
            Select any coin above or click the Watch button on a Dashboard signal card.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {watchlist.map((sym) => {
            const coin = TRACKED_COINS.find((c) => c.symbol === sym);
            const t = tickers[sym];
            const isUp = (t?.change24hPercent ?? 0) >= 0;

            return (
              <div
                key={sym}
                className="rounded-xl border border-slate-800/90 bg-[#111827] p-5 space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">
                      {coin?.name || sym}{' '}
                      <span className="font-mono text-xs text-slate-400">{sym}</span>
                    </h2>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="font-mono text-lg font-semibold tabular-nums text-white">
                        ${formatCryptoPrice(t?.price ?? coin?.referencePrice ?? 0)}
                      </span>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          isUp ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isUp ? '+' : ''}
                        {(t?.change24hPercent ?? 0).toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSymbol(sym);
                        navigate('/');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0d1323] px-3 py-2 text-xs font-medium text-white hover:border-[#3b82f6] cursor-pointer whitespace-nowrap"
                    >
                      <TrendingUp className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
                      <span>Open Chart</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleWatchlist(sym)}
                      aria-label={`Remove ${sym} from watchlist`}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#0d1323] p-2 text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-800/80 pt-4">
                  <SentimentMeter symbol={sym} compact embedded />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
