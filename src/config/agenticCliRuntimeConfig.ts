/**
 * Signal Forge — Agentic CLI Runtime Configuration
 *
 * Allowlisted workspace configuration module editable by the local script
 * editor after explicit operator confirmation.
 */
export interface AgenticCliRuntimeConfig {
  readonly terminalTitle: string;
  readonly promptPrefix: string;
  readonly bannerTagline: string;
  readonly defaultVoiceLanguage: string;
  readonly requireDiffPreview: boolean;
}

export const AGENTIC_CLI_RUNTIME_CONFIG: AgenticCliRuntimeConfig = {
  terminalTitle: 'Signal Forge Agentic CLI Orchestrator',
  promptPrefix: 'sf-agent>',
  bannerTagline: 'Unified Model Gateway · Voice-to-UI & Confirmed Local Script Editor',
  defaultVoiceLanguage: 'en-US',
  requireDiffPreview: true,
};
