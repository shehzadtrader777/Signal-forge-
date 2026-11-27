/**
 * Signal Forge Emergency Halt — safe client presentation contract.
 *
 * IMPORTANT: Presentation only. A positive local state NEVER authorizes
 * trading or clears a server-side halt. No recovery endpoint is called here.
 * Server must independently enforce fail-closed execution gates.
 */
export type HaltAuthorityState =
  | 'UNKNOWN'
  | 'HALT_REQUESTED'
  | 'HALTED_CONFIRMED'
  | 'RECOVERY_PENDING'
  | 'HALTED_RECOVERY_REJECTED'
  | 'RESUME_APPROVED_EXECUTION_LOCKED';

export interface HaltAuthoritySnapshot {
  readonly state: HaltAuthorityState;
  readonly revision: number;
  readonly sealId: string | null;
  readonly acknowledgedAtIso: string | null;
  readonly source: 'server';
  readonly executionEnabled: false;
}

export interface HaltPresentation {
  readonly label: string;
  readonly tone: 'danger' | 'warning' | 'success';
  readonly isHaltConfirmed: boolean;
  readonly showEmergencyBanner: boolean;
  readonly allowRecoveryRequest: boolean;
  readonly allowsTrading: false;
}

export function deriveHaltPresentation(
  snapshot: HaltAuthoritySnapshot | null,
  requestInFlight = false,
): HaltPresentation {
  if (!snapshot) {
    return {
      label: requestInFlight ? 'Emergency halt requested — awaiting server acknowledgement' : 'Safety state unknown — reconnect to verify',
      tone: 'warning',
      isHaltConfirmed: false,
      showEmergencyBanner: true,
      allowRecoveryRequest: false,
      allowsTrading: false,
    };
  }
  if (snapshot.state === 'HALTED_CONFIRMED' || snapshot.state === 'HALTED_RECOVERY_REJECTED') {
    return {
      label: snapshot.state === 'HALTED_RECOVERY_REJECTED' ? 'Emergency halt active — recovery rejected' : 'Emergency halt confirmed by server',
      tone: 'danger',
      isHaltConfirmed: true,
      showEmergencyBanner: true,
      allowRecoveryRequest: true,
      allowsTrading: false,
    };
  }
  if (snapshot.state === 'RECOVERY_PENDING') {
    return {
      label: 'Recovery verification pending — trading remains locked',
      tone: 'warning',
      isHaltConfirmed: false,
      showEmergencyBanner: true,
      allowRecoveryRequest: false,
      allowsTrading: false,
    };
  }
  if (snapshot.state === 'RESUME_APPROVED_EXECUTION_LOCKED') {
    return {
      label: 'Halt cleared by server — trading still locked',
      tone: 'success',
      isHaltConfirmed: false,
      showEmergencyBanner: false,
      allowRecoveryRequest: false,
      allowsTrading: false,
    };
  }
  return {
    label: snapshot.state === 'HALT_REQUESTED' ? 'Emergency halt submitted — waiting for acknowledgement' : 'Safety state unknown — trading locked',
    tone: 'warning',
    isHaltConfirmed: false,
    showEmergencyBanner: true,
    allowRecoveryRequest: false,
    allowsTrading: false,
  };
}

/** Reject stale or forged-shaped local updates; real authentication belongs on server. */
export function acceptNewerAuthoritativeSnapshot(
  current: HaltAuthoritySnapshot | null,
  incoming: HaltAuthoritySnapshot,
): HaltAuthoritySnapshot | null {
  if (incoming.source !== 'server' || incoming.executionEnabled !== false) return current;
  if (!Number.isSafeInteger(incoming.revision) || incoming.revision < 0) return current;
  if (current && incoming.revision <= current.revision) return current;
  return incoming;
}
