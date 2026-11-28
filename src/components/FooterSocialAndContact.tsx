import { memo } from 'react';
import { Mail, ShieldAlert } from 'lucide-react';
import { FloatingTelegramChannel } from './FloatingTelegramChannel';

export const CONTACT_EMAIL_ADDRESS =
  (import.meta.env.VITE_PUBLIC_SUPPORT_EMAIL || '').trim() || 'support@signalforge.app';
export const WHATSAPP_DESK_URL = (import.meta.env.VITE_PUBLIC_WHATSAPP_URL || '').trim();
export const DISCORD_COMMUNITY_URL = 'https://discord.gg/signalforge';

export const DedicatedEmailIconLink = memo(function DedicatedEmailIconLink({
  testId = 'about-email-icon-link',
}: {
  readonly testId?: string;
}) {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL_ADDRESS}`}
      aria-label="Send email to Signal Forge Support"
      title="Email Signal Forge Support"
      data-testid={testId}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-[#0d1526] text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/15 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400"
    >
      <Mail className="h-4 w-4" aria-hidden="true" />
    </a>
  );
});

export const GEMINI_DISCLAIMER_TEXT =
  'This system was architected with the assistance of Gemini, an AI assistant. Trading in financial markets involves substantial risk of capital loss. This tool provides analytical automation but does not guarantee profitability; continuous monitoring and strict risk management remain the sole responsibility of the user.';

const WHATSAPP_SVG_PATH =
  'M12.031 2C6.498 2 2 6.492 2 12.018c0 1.766.462 3.49 1.339 5.01L2 22l5.106-1.338a10.01 10.01 0 004.925 1.29h.004c5.532 0 10.03-4.492 10.03-10.018A9.97 9.97 0 0019.124 4.93 9.963 9.963 0 0012.031 2zm5.887 14.236c-.249.701-1.456 1.34-2.013 1.425-.511.077-1.174.11-1.894-.119-.438-.139-1.001-.325-1.724-.637-3.035-1.31-5.016-4.38-5.168-4.582-.152-.202-1.234-1.64-1.234-3.13 0-1.49.78-2.222 1.057-2.525.277-.303.605-.379.806-.379.202 0 .403.002.58.011.186.009.436-.071.682.52.252.606.857 2.096.932 2.248.076.152.126.329.025.531-.101.202-.151.328-.303.505-.151.177-.318.395-.454.531-.151.151-.309.315-.133.618.177.303.786 1.297 1.687 2.1 1.159 1.034 2.136 1.355 2.439 1.506.303.152.48.126.656-.076.177-.202.757-.884.959-1.187.202-.303.403-.253.681-.152.278.101 1.766.833 2.069.985.303.151.505.227.58.353.076.127.076.733-.173 1.434z';

const DISCORD_SVG_PATH =
  'M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';

export const OfficialGeminiLogo = memo(function OfficialGeminiLogo({
  className = 'h-4 w-4',
}: {
  readonly className?: string;
}) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      data-testid="official-gemini-logo"
    >
      <defs>
        <linearGradient id="signalForgeGeminiGrad" x1="2" y1="2" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="52%" stopColor="#9B72CB" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M14 1.5C14.7 8.4 19.6 13.3 26.5 14C19.6 14.7 14.7 19.6 14 26.5C13.3 19.6 8.4 14.7 1.5 14C8.4 13.3 13.3 8.4 14 1.5Z"
        fill="url(#signalForgeGeminiGrad)"
      />
    </svg>
  );
});

/**
 * Streamlined Footer Attribution: retains ONLY "Developed by Amir Shehzad",
 * "Co-developed with Gemini", and the mandatory financial/AI risk disclaimer.
 */
export const GeminiCollaborationAttribution = memo(function GeminiCollaborationAttribution() {
  return (
    <div
      data-testid="footer-gemini-attribution"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <span className="font-display font-semibold text-white">
          Developed by Amir Shehzad
        </span>
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        <span
          data-testid="footer-gemini-credit"
          className="inline-flex items-center gap-1.5 font-medium text-slate-200"
        >
          <OfficialGeminiLogo className="h-4 w-4 shrink-0" />
          <span>Co-developed with Gemini</span>
        </span>
      </div>

      <div
        id="gemini-disclaimer-panel"
        data-testid="footer-gemini-disclaimer"
        className="flex items-start gap-2.5 border-t border-slate-800/80 pt-3 text-[11px] leading-relaxed text-slate-400"
      >
        <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p>{GEMINI_DISCLAIMER_TEXT}</p>
      </div>
    </div>
  );
});

/**
 * Permanently anchored circular bottom-left social widgets: WhatsApp, Telegram, and Discord.
 */
export const AnchoredSocialWidgets = memo(function AnchoredSocialWidgets() {
  return (
    <nav
      aria-label="Anchored Community Social Widgets"
      data-testid="anchored-social-dock"
      className="fixed bottom-3 left-3 sm:bottom-5 sm:left-6 z-40 flex items-center gap-2 sm:gap-2.5 pb-[env(safe-area-inset-bottom)]"
    >
      {WHATSAPP_DESK_URL ? (
        <a
          href={WHATSAPP_DESK_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp with Signal Forge Support"
          title="WhatsApp Support Desk"
          data-testid="social-circle-whatsapp"
          className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-emerald-400/50 bg-[#0b1322]/95 text-emerald-400 shadow-lg shadow-black/50 backdrop-blur-md transition-transform duration-150 hover:-translate-y-0.5 hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5 fill-current" aria-hidden="true">
            <path d={WHATSAPP_SVG_PATH} />
          </svg>
        </a>
      ) : null}

      <FloatingTelegramChannel />

      <a
        href={DISCORD_COMMUNITY_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join Signal Forge on Discord"
        title="Signal Forge Discord"
        data-testid="social-circle-discord"
        className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-indigo-400/45 bg-[#0b1322]/95 text-[#7289DA] shadow-lg shadow-black/50 backdrop-blur-md transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#5865F2] hover:text-white hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5 fill-current" aria-hidden="true">
          <path d={DISCORD_SVG_PATH} />
        </svg>
      </a>
    </nav>
  );
});
