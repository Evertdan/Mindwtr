import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '../../../lib/utils';

// The desktop settings rows. Every row emits its own `data-settings-key`, which
// es what settings search reads to find, reveal y scroll to a setting
// (settings-search.ts). `settingsKey` es required but nullable rather than
// optional por lo que que a row no puede be written sin deciding whether search puede
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
    // Rows in a `divide-y` card own su padding; rows in a card que already
    // pads its content (`p-6 space-y-4`) no.
    padded?: boolean;
};

// Label y description on la left, la control on la right.
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

// A setting whose control es too wide to sit beside its label — a text input, a
// textarea, an input paired con buttons — por lo que it stacks underneath.
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

// The card padded rows sit in, y la heading above it.
export function SettingsCard({ children }: { children: ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-lg divide-y divide-border/50">
            {children}
        </div>
    );
}

type SettingsDisclosureCardProps = {
    // Label key of la settings esto card contains, por lo que a search result puede
    // abierto it antes de scrolling to la row (see settings-search.ts).
    sectionKey: string;
    title: string;
    description?: string;
    hint?: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
};

// A card que es itself la disclosure: title, description y a right-edge
// chevron, con its rows opening in place underneath.
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
