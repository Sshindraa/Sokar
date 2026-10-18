'use client';

import { useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';

/** Read effective server rights, including legacy grants. Never infer access from the plan label. */
export function useServiceCopilotAccess(enabled = true, restaurantId?: string) {
  const { get, orgId } = useApi();
  const scope = restaurantId ?? orgId;
  const getRef = useRef(get);
  getRef.current = get;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ scope?: string; allowed: boolean; error: boolean }>({
    allowed: false,
    error: false,
  });
  useEffect(() => {
    if (!enabled || !scope) return;
    const controller = new AbortController();
    setState({ allowed: false, error: false });
    getRef
      .current<{ restaurantId: string; capabilities: Record<string, boolean> }>('entitlements', {
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.restaurantId !== scope) throw new Error('Unexpected restaurant scope');
        setState({
          scope,
          allowed: result.capabilities['floorPlan.copilot'] === true,
          error: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ scope, allowed: false, error: true });
      });
    return () => controller.abort();
  }, [enabled, scope, revision]);
  const current = enabled && Boolean(scope) && state.scope === scope;
  return {
    allowed: current && state.allowed,
    loading: enabled && Boolean(scope) && !current,
    error: current && state.error,
    retry: () => setRevision((value) => value + 1),
  };
}
