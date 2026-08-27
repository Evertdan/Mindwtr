/**
 * Story 2.1 — the WS channel's pure logic, kept separate from the real
 * `Bun.serve` wiring in server.ts, mirroring the split scheduler.ts already
 * keeps between `runNamespaceTick` (decision logic) and the `setInterval`
 * caller that actually runs it: token resolution and the per-namespace
 * connection registry are both plain functions/data structures here,
 * testable without a real socket, port or process. server.ts is the only
 * caller — it owns the native `Bun.serve` `upgrade()`/`websocket` wiring and
 * imports this module directly (not through `./index`, which stays the
 * server-only HTTP contract's barrel).
 */
import { isAuthorizedToken, tokenToKey, type AllowedAuthTokens } from '../server-auth';
import { BEARER_TOKEN_PATTERN } from '../server-config';
import { TDAH_ERRORS, type TdahErrorCode, type TdahWsConnectedEvent } from './types';

/**
 * Mounted by server.ts alongside `TDAH_PATH_PREFIX`'s HTTP routes but
 * dispatched separately, ahead of `handleTdahRequest`'s prefix match — this
 * exact path would otherwise fall through to that dispatcher's catch-all
 * 404 (it starts with `${TDAH_PATH_PREFIX}/` too).
 */
export const TDAH_WS_PATH = '/v1/tdah/ws';

/**
 * RN's `WebSocket` client can't set custom headers on the upgrade handshake
 * (Design Notes), so the bearer token travels as this query param instead
 * of an `Authorization` header.
 */
export const TDAH_WS_TOKEN_QUERY_PARAM = 'token';

export type TdahWsAuthResult =
    | { ok: true; key: string }
    | { ok: false; code: TdahErrorCode };

/**
 * Same bearer-token check every HTTP TDAH route gets via `withNamespace`
 * (server-request.ts's `getToken` + `isAuthorizedToken` + `tokenToKey`),
 * minus the header lookup: this reads the `token` query param instead of
 * `Authorization`, then reuses the identical format check
 * (`BEARER_TOKEN_PATTERN`) and allowlist check (`isAuthorizedToken`), so a
 * WS connection is authorized under exactly the same rules as an HTTP
 * request from the same client. A missing, malformed, or unauthorized token
 * all collapse to the same single `.code` — the channel never distinguishes
 * "absent" from "wrong" (Design Notes: server rejects the upgrade either
 * way, no separate signal exists for the client to react to differently).
 */
export function resolveTdahWsAuth(url: URL, allowedAuthTokens: AllowedAuthTokens | null): TdahWsAuthResult {
    const token = url.searchParams.get(TDAH_WS_TOKEN_QUERY_PARAM);
    if (!token || !BEARER_TOKEN_PATTERN.test(token) || !isAuthorizedToken(token, allowedAuthTokens)) {
        return { ok: false, code: TDAH_ERRORS.wsUnauthorized };
    }
    return { ok: true, key: tokenToKey(token) };
}

/** The event sent once, right after `open`, on every successful upgrade (types.ts's `TdahWsConnectedEvent`). */
export function buildTdahWsConnectedEvent(now: Date): TdahWsConnectedEvent {
    return { kind: 'connected', at: now.toISOString() };
}

/**
 * Active WS connections, grouped by namespace key — story 2.2's scheduler
 * will read this registry to know which live sockets to push an
 * activity-trigger event to. Generic over the connection type so this stays
 * testable with plain fake objects in unit tests; server.ts instantiates it
 * once per running server with Bun's real `ServerWebSocket`.
 *
 * Pure in-memory bookkeeping only — registering/unregistering never touches
 * a socket (no `.send`/`.close` calls), the same split `runNamespaceTick`
 * keeps between deciding what to do and the real wiring that does it.
 */
export type TdahWsConnectionRegistry<TConnection> = {
    register: (key: string, connection: TConnection) => void;
    unregister: (key: string, connection: TConnection) => void;
    connectionsFor: (key: string) => ReadonlySet<TConnection>;
    connectionCount: (key: string) => number;
    namespaceCount: () => number;
};

export function createTdahWsConnectionRegistry<TConnection>(): TdahWsConnectionRegistry<TConnection> {
    const connectionsByKey = new Map<string, Set<TConnection>>();

    return {
        register(key, connection) {
            let connections = connectionsByKey.get(key);
            if (!connections) {
                connections = new Set();
                connectionsByKey.set(key, connections);
            }
            connections.add(connection);
        },
        unregister(key, connection) {
            const connections = connectionsByKey.get(key);
            if (!connections) return;
            connections.delete(connection);
            // Drop the empty Set immediately rather than letting it linger —
            // namespaceCount() must reflect namespaces with at least one live
            // connection, never one that reconnected to zero and left a
            // dangling empty entry behind.
            if (connections.size === 0) connectionsByKey.delete(key);
        },
        connectionsFor(key) {
            return connectionsByKey.get(key) ?? new Set();
        },
        connectionCount(key) {
            return connectionsByKey.get(key)?.size ?? 0;
        },
        namespaceCount() {
            return connectionsByKey.size;
        },
    };
}
