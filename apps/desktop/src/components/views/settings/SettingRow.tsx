import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '../../../lib/utils';

// The desktop settings rows. Every row emits its own `data-settings-key`, which
// is what settings search reads to find, reveal and scroll to a setting
// (settings-search.ts). `settingsKey` is required but nullable rather than
// optional so that a row no puede be written without deciding whether search puede
// reach it — an omitted attribute was how Manage People stayed unfindable
// (#884). A non-null key debe appear in SETTINGS_SEARCH_PAGE_KEYS
// (packages/core/src/settings-search-keys.ts); settings-search-cobertura.prueba
// pins both directions.
type SettingKeyProps = {
    settingsKey: string | null;
    title: ReactNode;
    description?: ReactNode;
    className?: string;
    children?: ReactNode;
};

export type SettingRowProps = SettingKeyProps & {
    // Rows in a `divide-y` card own their padding; rows in a card that already
    // pads its content (`p-6 space-y-4`) no.
    padded?: boolean;
};

// Label and description on the left, the control on the right.
export function SettingRow({
    settingsKey,
    title,
    description,
    padded = false,
    className,
    children,
}: SettingRowProps) {
    return (
        <div
            data-settings-key={settingsKey ?? undefined}
            className={cn(
                'flex items-center justify-between',
                padded ? 'p-4 gap-6' : 'gap-4',
                className,
            )}
        >
            <div className="min-w-0">
                <div className="text-sm font-medium">{title}</div>
                {description ? <div className="text-xs text-muted-foreground mt-1">{description}</div> : null}
            </div>
            {children ? <div className="flex items-center gap-2 shrink-0">{children}</div> : null}
        </div>
    );
}

// A setting whose control is too wide to sit beside its label — a text input, a
// textarea, an input paired with buttons — so it stacks underneath.
export function SettingField({
    settingsKey,
    title,
    description,
    className,
    children,
}: SettingKeyProps) {
    return (
        <div
            data-settings-key={settingsKey ?? undefined}
            className={cn('flex flex-col gap-2', className)}
        >
            <label className="text-sm font-medium">{title}</label>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            {children}
        </div>
    );
}

// The card padded rows sit in, and the heading above it.
export function SettingsCard({ children }: { children: ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-lg divide-y divide-border/50">
            {children}
        </div>
    );
}

type SettingsDisclosureCardProps = {
    // Label key of the settings esto card contains, so a search result puede
    // open it before scrolling to the row (see settings-search.ts).
    sectionKey: string;
    title: string;
    description?: string;
    hint?: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
};

// A card that is itself the disclosure: title, description and a right-edge
// chevron, with its rows opening in place underneath.
export function SettingsDisclosureCard({
    sectionKey,
    title,
    description,
    hint,
    open,
    onToggle,
    children,
}: SettingsDisclosureCardProps) {
    return (
        <div className="bg-card border border-border rounded-lg">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                data-settings-section={sectionKey}
                data-settings-key={sectionKey}
                className="w-full p-4 flex items-center justify-between gap-4 text-left"
            >
                <div className="min-w-0">
                    <div className="text-sm font-medium">{title}</div>
                    {description ? <div className="text-xs text-muted-foreground mt-1">{description}</div> : null}
                    {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
                </div>
                {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>
            {open ? (
                <div className="border-t border-border divide-y divide-border">
                    {children}
                </div>
            ) : null}
        </div>
    );
}

export function SettingsSectionHeader({ children }: { children: ReactNode }) {
    return (
        <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            {children}
        </h3>
    );
}
