import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useApp } from '../context/AppContext';
import type { RbacPermission, RbacRole } from '../lib/rbac';

export interface ClientRbacProfile {
  authenticated: boolean;
  uid: string | null;
  role: RbacRole;
  permissions: readonly RbacPermission[];
  canAccessTestConsole: boolean;
  canAccessDebugEndpoints: boolean;
}

const GUEST_RBAC: ClientRbacProfile = {
  authenticated: false,
  uid: null,
  role: 'GUEST',
  permissions: ['DASHBOARD_VIEW', 'BACKTEST_RUN'],
  canAccessTestConsole: false,
  canAccessDebugEndpoints: false,
};

/**
 * Fetches server-authoritative RBAC role & permissions using the caller's verified
 * Firebase Auth ID token so UI navigation (e.g. Test/Trust Console visibility) strictly
 * mirrors backend-enforced authorization.
 */
export function useRbacIdentity() {
  const { user, authReady } = useApp();
  const [rbac, setRbac] = useState<ClientRbacProfile>(GUEST_RBAC);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setRbac(GUEST_RBAC);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await apiFetch('/api/auth/rbac-profile', { method: 'GET' });
      if (!res.ok) {
        setRbac(GUEST_RBAC);
        return;
      }
      const data = (await res.json()) as { ok?: boolean; rbac?: ClientRbacProfile };
      if (data?.ok && data.rbac) {
        setRbac(data.rbac);
      } else {
        setRbac(GUEST_RBAC);
      }
    } catch {
      setRbac(GUEST_RBAC);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authReady) return;
    refresh();
  }, [authReady, user?.uid, user?.emailVerified, refresh]);

  return { rbac, loading, refresh };
}
