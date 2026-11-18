import { useEffect, useState } from 'react';
import { MessageSquareText } from 'lucide-react';

export interface LunarCrushSentimentData {
  source: string;
  symbol: string;
  baseAsset: string;
  bullishPercent: number;
  bearishPercent: number;
  socialVolume: number;
  galaxyScore: number;
  sentimentScore: number;
  trendingHashtags: string[];
}

interface SentimentMeterProps {
  symbol: string;
  compact?: boolean;
  embedded?: boolean;
}

export function SentimentMeter({
  symbol,
  compact = false,
  embedded = false,
}: SentimentMeterProps) {
  const [data, setData] = useState<LunarCrushSentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/sentiment/${encodeURIComponent(symbol)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!active) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  if (loading && !data) {
    return (
      <div className={embedded ? '' : 'rounded-xl border border-slate-800/90 bg-[#111827] p-5'}>
        <div className="h-4 w-40 rounded bg-slate-800 animate-pulse" />
        <div className="mt-4 h-3 w-full rounded bg-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const toneLabel =
    data.sentimentScore >= 65
      ? 'Bullish Consensus'
      : data.sentimentScore <= 42
      ? 'Bearish Pressure'
      : 'Mixed Sentiment';

  return (
    <section
      aria-label={`${data.baseAsset} Social Sentiment Meter`}
      className={embedded ? '' : 'rounded-xl border border-slate-800/90 bg-[#111827] p-5'}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <MessageSquareText className="h-3.5 w-3.5 text-[#3b82f6]" aria-hidden="true" />
            <span>Social Media Sentiment · LunarCrush Feed</span>
          </div>
          <h3 className="mt-1 font-display text-base font-bold text-white">
            {data.baseAsset} Crowd Sentiment — {toneLabel}
          </h3>
        </div>
        <div className="text-right shrink-0">
          <span className="block text-[11px] text-slate-400">Sentiment Score</span>
          <span className="font-mono text-lg font-bold tabular-nums text-white">
            {data.sentimentScore}/100
          </span>
        </div>
      </div>

      {/* Bullish vs Bearish Progress Bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs font-medium mb-1.5">
          <span className="text-emerald-400 font-mono tabular-nums">
            Bullish {data.bullishPercent}%
          </span>
          <span className="text-rose-400 font-mono tabular-nums">
            Bearish {data.bearishPercent}%
          </span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="bg-emerald-500 transition-all duration-300"
            style={{ width: `${data.bullishPercent}%` }}
          />
          <div
            className="bg-rose-500 transition-all duration-300"
            style={{ width: `${data.bearishPercent}%` }}
          />
        </div>
      </div>

      {/* Social Volume + Galaxy Score + Hashtags */}
      <div
        className={`mt-4 grid gap-3 border-t border-slate-800/80 pt-3.5 text-xs ${
          compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'
        }`}
      >
        <div>
          <span className="block text-slate-400">24h Social Volume</span>
          <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-white">
            {data.socialVolume.toLocaleString('en-US')} mentions
          </span>
        </div>

        <div>
          <span className="block text-slate-400">Galaxy Score</span>
          <span className="mt-0.5 block font-mono text-sm font-semibold tabular-nums text-[#3b82f6]">
            {data.galaxyScore} / 100
          </span>
        </div>

        <div className={compact ? 'col-span-2' : ''}>
          <span className="block text-slate-400">Trending Hashtags</span>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-slate-200 font-mono text-xs">
            {data.trendingHashtags.map((tag, idx) => (
              <span key={tag} className="inline-flex items-center gap-1.5">
                <span className="text-blue-300">{tag}</span>
                {idx < data.trendingHashtags.length - 1 && (
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
