# Signal Forge — Design Lock and AI Studio Handoff (27 Nov 2026)

Development branch: `feature/ai-studio-source-migration`. Do not merge or deploy without explicit review.

## Approved visual direction
- Default **Dark Forge**: gunmetal/charcoal, restrained bronze; no generic bright-blue branded appearance.
- Optional **Light Forge**: warm white, graphite text, subtle raised surfaces and shadows.
- **Manrope** for branded headings; **Inter** for interface and body. Preserve monospaced/tabular display for trading figures.
- World-map treatment should be subtle and must not obscure charts, data or text. A map visual is still pending.
- Entrance motion uses gentle fades and upward movement; chart bars animate only when reduced motion is not requested.
- Consistent rhythm and responsive spacing across public landing, workspace, pricing and auth.
- Login/signup: brand mark and name at top; necessary inputs only; optional referral code on signup. Referral validation/storage is NOT implemented in this change.
- AI Super Guide is educational/read-only. Full conversational backend is NOT implemented.

## Implemented in this checkpoint
- Scoped Dark Forge and Light Forge CSS variables on the `/welcome` landing page.
- Visible accessible appearance toggle with `aria-pressed`, saved in **localStorage on the current browser**.
- Manrope/Inter font loading, bronze CTA treatment, darker cards, responsive refinements and reduced-motion-safe animation.
- Existing app trading features/security logic left untouched.

## Remaining integration and acceptance
1. Bring the same tokens into auth, pricing and workspace, avoiding CSS overrides of trading terminals.
2. Implement user-account-synced theme preference after auth with Firestore rules, conflicts/default migration and emulator tests. Local browser preference is not cloud sync.
3. Integrate a reviewed world-map asset in landing/dashboard without misleading live global statistics or obscured content.
4. Implement optional referral input and safe server-side referral redemption with abuse prevention.
5. Reconcile Google AI Studio export against GitHub changes, review diffs and preserve security rules/secrets.
6. Visual screenshots at phone/tablet/desktop widths, keyboard/contrast tests, reduced motion, typecheck, unit tests and production build.
7. Security/code review and owner approval; no production deployment or LIVE mode unlocking.

## AI Studio sync guidance
Export the **current GitHub development branch** and compare with the latest AI Studio source before importing. Avoid directly overwriting `src/lib/firebase.ts`, `firestore.rules`, auth flows, trading-mode boundaries, env files or working dashboard features. Treat this file as a checkpoint spec, not proof of complete migration.
