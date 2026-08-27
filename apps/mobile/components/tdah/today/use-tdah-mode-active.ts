import { useEffect, useState } from 'react';

import { cloudGetJson } from '@mindwtr/core';

import { buildTdahProfileUrl, buildTdahRequestOptions, loadTdahCloudConfig } from './tdah-today-cloud';

type TdahProfileState = {
    mode: 'on' | 'off';
};

/**
 * Whether ADHD mode is active, for the Menu tile's guaranteed E-05 entry
 * point (spec Boundaries: "a guaranteed, always-present entry point ... when
 * the mode is active"). No client-side caching of the mode flag (that would
 * be exactly the new caching layer the spec's Block If clause forbids
 * inventing for the *home-route* conditional) — instead, `refreshKey` lets
 * the caller re-run the fetch on a meaningful event. The More sheet
 * (`(tabs)/_layout.tsx`) stays mounted across opens/closes rather than
 * remounting, so it passes its own `visible` flag here: each `true` value is
 * a new `refreshKey`, giving a fresh GET every time the sheet opens instead
 * of only once at app boot.
 *
 * Defaults to `false` while loading, on a missing/failed profile fetch, or
 * when Self-Hosted sync isn't configured — the tile only appears once the
 * server has confirmed the mode is genuinely on.
 */
export function useTdahModeActive(refreshKey?: unknown): boolean {
    const [active, setActive] = useState(false);

    useEffect(() => {
        // A `cancelled` flag scoped to this effect run (not a hook-lifetime
        // ref) — `refreshKey` changing twice in quick succession (sheet
        // opened/closed rapidly) must let this run's cleanup mark it stale so
        // an older in-flight fetch resolving after a newer one can never
        // overwrite the fresher `active` state. Same idiom as e.g.
        // use-sync-settings-transport-actions.ts's effects.
        let cancelled = false;
        (async () => {
            try {
                const cloud = await loadTdahCloudConfig();
                if (!cloud) {
                    if (!cancelled) setActive(false);
                    return;
                }
                const result = await cloudGetJson<{ profile: TdahProfileState | null }>(
                    buildTdahProfileUrl(cloud.url),
                    buildTdahRequestOptions(cloud),
                );
                if (cancelled) return;
                setActive(result?.profile?.mode === 'on');
            } catch {
                if (!cancelled) setActive(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshKey]);

    return active;
}
