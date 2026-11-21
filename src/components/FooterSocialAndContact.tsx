import { memo, useState } from 'react';
import { Mail, ShieldAlert } from 'lucide-react';

export const CONTACT_EMAIL_ADDRESS = 'amirshehzad2647tcs@gmail.com';
export const WHATSAPP_DESK_URL = 'https://wa.me/923015083557';

export const GEMINI_DISCLAIMER_TEXT =
  'This system was architected with the assistance of Gemini, an AI assistant. Trading in financial markets involves substantial risk of capital loss. This tool provides analytical automation but does not guarantee profitability; continuous monitoring and strict risk management remain the sole responsibility of the user.';

interface SocialLinkItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly svgPath: string;
  readonly viewBox: string;
}

export const SOCIAL_MEDIA_LINKS: readonly SocialLinkItem[] = Object.freeze([
  {
    id: 'x',
    label: 'Signal Forge on X (Twitter)',
    href: 'https://x.com/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  {
    id: 'github',
    label: 'Signal Forge on GitHub',
    href: 'https://github.com/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  {
    id: 'linkedin',
    label: 'Signal Forge on LinkedIn',
    href: 'https://linkedin.com/company/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  {
    id: 'youtube',
    label: 'Signal Forge on YouTube',
    href: 'https://youtube.com/@signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  {
    id: 'discord',
    label: 'Signal Forge on Discord',
    href: 'https://discord.gg/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z',
  },
  {
    id: 'telegram',
    label: 'Signal Forge on Telegram',
    href: 'https://t.me/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  },
  {
    id: 'instagram',
    label: 'Signal Forge on Instagram',
    href: 'https://instagram.com/signalforge',
    viewBox: '0 0 24 24',
    svgPath:
      'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  },
]);

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

export const DedicatedEmailIconLink = memo(function DedicatedEmailIconLink({
  testId = 'footer-email-icon-link',
}: {
  readonly testId?: string;
}) {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL_ADDRESS}`}
      aria-label="Send email to Amir Shahzad"
      title="Email Amir Shahzad"
      data-testid={testId}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-[#0d1526] text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/15 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400"
    >
      <Mail className="h-4 w-4" aria-hidden="true" />
    </a>
  );
});

export const GeminiCollaborationAttribution = memo(function GeminiCollaborationAttribution() {
  const [disclaimerExpanded, setDisclaimerExpanded] = useState<boolean>(true);

  return (
    <div
      data-testid="footer-gemini-attribution"
      className="space-y-2.5"
    >
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
        <span className="font-semibold text-white">Amir Shahzad</span>
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          onClick={() => setDisclaimerExpanded((prev) => !prev)}
          aria-expanded={disclaimerExpanded}
          aria-controls="gemini-disclaimer-panel"
          data-testid="footer-gemini-logo-btn"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700/90 bg-[#0b1325] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-400/60 hover:text-white transition-colors cursor-pointer"
          title="View Gemini Collaboration Disclaimer & Risk Guidelines"
        >
          <OfficialGeminiLogo className="h-4 w-4 shrink-0" />
          <span>Co-developed with Gemini</span>
        </button>
      </div>

      {disclaimerExpanded && (
        <div
          id="gemini-disclaimer-panel"
          data-testid="footer-gemini-disclaimer"
          className="rounded-lg border border-slate-800/90 bg-[#080f1f] px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400 flex items-start gap-2.5"
        >
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <p>{GEMINI_DISCLAIMER_TEXT}</p>
        </div>
      )}
    </div>
  );
});

export const FooterSocialIconsRow = memo(function FooterSocialIconsRow() {
  return (
    <nav
      aria-label="Signal Forge Social Media Links"
      data-testid="footer-social-icons"
      className="flex flex-wrap items-center gap-2"
    >
      {SOCIAL_MEDIA_LINKS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={item.label}
          title={item.label}
          data-testid={`footer-social-${item.id}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800/90 bg-[#0b1325] text-slate-400 hover:border-cyan-500/50 hover:bg-cyan-500/10 hover:text-cyan-300 transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <svg
            viewBox={item.viewBox}
            className="h-4 w-4 fill-current"
            aria-hidden="true"
          >
            <path d={item.svgPath} />
          </svg>
        </a>
      ))}
    </nav>
  );
});
