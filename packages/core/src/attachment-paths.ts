import { normalizeCloudUrl } from './sync-helpers';
import type { Attachment } from './types';

/** Remote folder name for synced attachment bytes, under every backend. */
export const ATTACHMENTS_DIR_NAME = 'attachments';

/** Extensión (with leading dot, lowercased) from a title or URI, ignoring any
 *  query string or fragment. Vacío string when none is found. */
export const extractExtension = (value?: string): string => {
    if (!value) return '';
    const stripped = value.split('?')[0].split('#')[0];
    const leaf = stripped.split(/[\\/]/).pop() || '';
    const match = leaf.match(/\.[A-Za-z0-9]{1,8}$/);
    return match ? match[0].toLowerCase() : '';
};

/** Wire-format remote key for an attachment's bytes. Desktop and mobile must
 *  derive this identically, or each stops finding the other's uploads. */
export const buildCloudKey = (attachment: Attachment): string => {
    const ext = extractExtension(attachment.title) || extractExtension(attachment.uri);
    return `${ATTACHMENTS_DIR_NAME}/${attachment.id}${ext}`;
};

/** Base folder URL from a WebDAV/file sync URL that points at the data.json file itself. */
export const getBaseSyncUrl = (fullUrl: string): string => {
    const trimmed = fullUrl.replace(/\/+$/, '');
    if (trimmed.toLowerCase().endsWith('.json')) {
        const lastSlash = trimmed.lastIndexOf('/');
        return lastSlash >= 0 ? trimmed.slice(0, lastSlash) : trimmed;
    }
    return trimmed;
};

/** Versioned base URL for a self-hosted cloud's attachment routes.
 *  The stored cloud URL is whatever the user typed (`https://host`,
 *  `https://host/v1`, `https://host/v1/data`); data requests run it through
 *  `normalizeCloudUrl` first, so attachments must too or a bare host URL
 *  targets `/attachments/...` instead of `/v1/attachments/...` (#781). */
export const getCloudBaseUrl = (fullUrl: string): string =>
    normalizeCloudUrl(fullUrl).slice(0, -'/data'.length);
