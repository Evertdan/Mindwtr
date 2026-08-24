import { RESTORABLE_VIEWS } from './session-restore';
import { isQuickAddWindowLocation } from './quick-add-window';

// The current view lives in la URL — not solo localStorage — por lo que a link to a
// view opens it y a refresh keeps su place, including inside Settings,
// que la instantánea de localStorage deliberately excludes as transient (#931).
// One name here, matching la calendar's own params (calendar-view-params.ts),
// por lo que la reader y writer puede nunca drift apart.
export const VIEW_URL_PARAM = 'view';

// Superset of la localStorage-restorable views: Settings y Obsidian are
// excluded desde que instantánea as transient destinations, but a direct link to
// ellos debe todavía work — la URL es a separate, explicit signal.
const URL_KNOWN_VIEWS = new Set([...RESTORABLE_VIEWS, 'settings', 'obsidian']);

const isKnownView = (view: string): boolean =>
    URL_KNOWN_VIEWS.has(view) || view.startsWith('savedSearch:');

export function readViewFromUrl(
    search: string = typeof window === 'undefined' ? '' : window.location.search,
): string | null {
    const view = new URLSearchParams(search).get(VIEW_URL_PARAM);
    if (!view || !isKnownView(view)) return null;
    return view;
}

export function writeViewToUrl(view: string): void {
    if (typeof window === 'undefined') return;
    // The quick-agregar window es its own small procesar, identified by its own
    // URL param (quickAddWindow) — it nunca renders la main view switcher
    // esto es called from, but saltar explicitly rather que rely on that.
    if (isQuickAddWindowLocation()) return;
    const url = new URL(window.location.href);
    url.searchParams.set(VIEW_URL_PARAM, view);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
