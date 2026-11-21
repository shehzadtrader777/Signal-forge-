import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, RefreshCw, Send } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const FloatingTelegramChannel = memo(function FloatingTelegramChannel() {
  const { telegramFeed, telegramHandle, telegramBotConfigured, refreshTelegramFeed } = useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative" data-testid="sticky-footer-telegram-widget">
      {open && (
        <section
          aria-label='"Signal Forge" Telegram Channel Feed'
          data-testid="telegram-channel-drawer"
          className="fixed bottom-[64px] left-4 sm:left-6 z-50 w-[min(390px,calc(100vw-2rem))] max-h-[440px] flex flex-col rounded-xl border border-slate-700/90 bg-[#0d1323] shadow-2xl overflow-hidden"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-[#111827] px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#3b82f6] text-white shrink-0">
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-sm font-bold text-white truncate">
                  Signal Forge · Telegram
                </h2>
                <p className="font-mono text-[10px] text-slate-400 truncate">
                  {telegramHandle} · {telegramBotConfigured ? 'Bot Token Active' : 'Stream Ready'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={refreshTelegramFeed}
                aria-label="Refresh Telegram Channel feed"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label='Close "Signal Forge" Telegram channel drawer'
                data-testid="telegram-drawer-close-btn"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Channel Message Feed */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#0a0e1a]/70">
            {telegramFeed.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 text-center text-xs text-slate-400">
                High-confidence setups approved by the Skeptic Agent auto-stream here in real time.
              </div>
            ) : (
              telegramFeed.map((post) => {
                const dirColor =
                  post.direction === 'BUY'
                    ? 'text-emerald-400'
                    : post.direction === 'SELL'
                    ? 'text-rose-400'
                    : 'text-blue-400';
                return (
                  <article
                    key={post.id}
                    className="rounded-lg border border-slate-800 bg-[#111827] p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-display font-bold ${dirColor}`}>
                        {post.symbol} · {post.direction}
                        {post.confidence ? ` (${post.confidence}%)` : ''}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                        {new Date(post.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200">
                      {post.message}
                    </pre>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px] text-slate-400">
                      <span>Channel: {post.channelName}</span>
                      <span className={post.deliveredViaBot ? 'text-emerald-400' : 'text-slate-400'}>
                        {post.deliveredViaBot ? 'Telegram Bot Dispatched' : 'Channel Window'}
                      </span>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Drawer Footer Link */}
          <div className="flex items-center justify-between border-t border-slate-800 bg-[#111827] px-4 py-2 text-[11px]">
            <span className="text-slate-400">Skeptic-filtered high conviction</span>
            <Link
              to="/alerts"
              onClick={() => setOpen(false)}
              className="text-[#3b82f6] hover:text-blue-400 font-semibold"
            >
              Alert Rules &rarr;
            </Link>
          </div>
        </section>
      )}

      {/* Pinned Sticky Footer Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label='Toggle "Signal Forge" Telegram Channel feed'
        data-testid="sticky-telegram-trigger-btn"
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-400 ${
          open
            ? 'border-[#3b82f6] bg-[#3b82f6]/20 text-white'
            : 'border-[#3b82f6]/45 bg-[#0d1526] text-white hover:border-[#3b82f6]'
        }`}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#3b82f6] text-white shrink-0">
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="text-left leading-tight">
          <span className="block font-display text-xs font-bold text-white">Telegram</span>
          <span className="hidden md:block font-mono text-[10px] text-slate-400 tabular-nums">
            {telegramFeed.length} signal{telegramFeed.length === 1 ? '' : 's'} ·{' '}
            {telegramBotConfigured ? 'Live' : 'Feed'}
          </span>
        </span>
      </button>
    </div>
  );
});
