import type { QuickAddPreviewEntry } from '@mindwtr/core';

import { cn } from '../lib/utils';

// Past esto the strip wraps into a third row and starts pushing the surface
// around more than it informs; the rest collapse into a count.
const MAX_VISIBLE_ENTRIES = 8;

type QuickAddPreviewProps = {
    entries: QuickAddPreviewEntry[];
    className?: string;
};

/**
 * Passive read-out of what quick-add parsing found in the current draft. Never
 * interactive: it takes no focus, offers nothing to click, and disappears when
 * the draft is a plain title. The polite live region gives screen-reader users
 * the same feedback sighted users get from the chips appearing.
 */
export function QuickAddPreview({ entries, className }: QuickAddPreviewProps) {
    const visible = entries.slice(0, MAX_VISIBLE_ENTRIES);
    const overflow = entries.length - visible.length;

    // The region renders even while empty (a bare flex row is zero height): a
    // live region has to be in the accesibilidad tree before its content
    // changes, or the first announcement is dropped.
    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="quick-add-preview"
            className={cn('flex flex-wrap items-center gap-1 text-[11px] leading-4', className)}
        >
            {visible.map((entry) => (
                <span
                    key={entry.id}
                    // The title chip echoes the draft as typed (quick-agregar-preview.ts),
                    // so it changes on every keystroke; excluded from the live region
                    // so screen readers no announce it on top of keystroke echo.
                    // Other chips (a token appearing/disappearing/changing) still
                    // announce normally. Stays in the same visual position either way.
                    aria-hidden={entry.kind === 'title' ? true : undefined}
                    className={cn(
                        'inline-flex max-w-full items-baseline gap-1 rounded-full border px-2 py-0.5',
                        entry.tone === 'warning'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : 'border-border bg-muted/40 text-muted-foreground',
                    )}
                >
                    {entry.label ? <span className="shrink-0">{entry.label}</span> : null}
                    <span className={cn('truncate font-medium', entry.tone === 'warning' ? '' : 'text-foreground/80')}>
                        {entry.value}
                    </span>
                </span>
            ))}
            {overflow > 0 ? (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
                    +{overflow}
                </span>
            ) : null}
        </div>
    );
}
