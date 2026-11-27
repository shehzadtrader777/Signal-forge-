import { memo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveTelegramChannelUrl } from '../lib/platformArchitecture';

const TELEGRAM_SVG_PATH =
  'M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z';

/**
 * Permanently anchored circular Telegram widget.
 * Opens the configured Signal Forge Telegram Channel directly (https://t.me/...).
 */
export const FloatingTelegramChannel = memo(function FloatingTelegramChannel() {
  const { telegramFeed, telegramHandle } = useApp();
  const channelUrl = resolveTelegramChannelUrl(telegramHandle);

  return (
    <div className="relative" data-testid="sticky-footer-telegram-widget">
      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open Signal Forge Telegram Channel (${telegramHandle})`}
        title={`Open Telegram Channel ${telegramHandle}`}
        data-testid="social-circle-telegram"
        className="relative inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-sky-400/50 bg-[#0b1322]/95 text-[#29B6F6] shadow-lg shadow-black/50 backdrop-blur-md transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#229ED9] hover:text-white hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5 fill-current" aria-hidden="true">
          <path d={TELEGRAM_SVG_PATH} />
        </svg>
        {telegramFeed.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-[#F0B90B] px-1 font-mono text-[9px] font-bold text-[#0B0E11] tabular-nums"
          >
            {telegramFeed.length > 9 ? '9+' : telegramFeed.length}
          </span>
        )}
      </a>
    </div>
  );
});
