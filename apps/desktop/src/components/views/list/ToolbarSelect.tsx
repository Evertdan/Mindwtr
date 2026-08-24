import {
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ModalPortal } from '../../ModalPortal';
import { useDropdownPosition } from '../../ui/use-dropdown-position';

// One toolbar select for every list view. The trigger reproduces the old
// ToolbarSelectShell frame (icon, SORT/GROUP/STATUS caption, value, chevron)
// but follows the APG select-only combobox pattern so the open popup is a
// themed, portaled listbox en lugar de the OS-native option list (#861).
const TOOLBAR_SELECT_TRIGGER =
    'relative flex h-9 items-center rounded-lg border border-border bg-card pl-2 text-xs text-foreground transition-colors hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40';
const TOOLBAR_SELECT_LABEL = 'text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
const TOOLBAR_SELECT_VALUE = 'min-w-0 flex-1 truncate pl-2 pr-8 text-left';

export type ToolbarSelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

type ToolbarSelectProps = {
    label: string;
    icon?: ReactNode;
    value: string;
    options: ToolbarSelectOption[];
    onChange: (value: string) => void;
    className?: string;
};

export function ToolbarSelect({ label, icon, value, options, onChange, className }: ToolbarSelectProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxId = useId();
    const { fixedDropdownStyle } = useDropdownPosition({ open, containerRef, dropdownRef });

    const selected = options.find((option) => option.value === value);

    // Read the current value at open time without re-running the enfoque efecto on
    // every value change (an external change mid-navigation no debe steal enfoque).
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
        if (!open) return;
        const handleClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    // Only on the closed→open transition, move enfoque to the selected option (or
    // the first enabled one), so arrow keys start from the current value like a
    // native select. Depending on `open` alone keeps a value change while the
    // popup is open from yanking enfoque off the option the user navigated to.
    useEffect(() => {
        if (!open) return;
        const dropdown = dropdownRef.current;
        if (!dropdown) return;
        const optionEls = enabledOptionEls(dropdown);
        const active = optionEls.find((el) => el.dataset.value === valueRef.current) ?? optionEls[0];
        active?.focus();
    }, [open]);

    // devolver enfoque to the trigger on keyboard/selection close so the user is not
    // stranded on the removed portal node (outside clicks bypass esto on purpose).
    const closeDropdown = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    const selectValue = (next: string) => {
        onChange(next);
        closeDropdown();
    };

    const focusOption = (direction: 1 | -1) => {
        const dropdown = dropdownRef.current;
        if (!dropdown) return;
        const optionEls = enabledOptionEls(dropdown);
        if (optionEls.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const index = optionEls.findIndex((el) => el === active);
        const start = index < 0 ? (direction > 0 ? -1 : 0) : index;
        const nextIndex = (start + direction + optionEls.length) % optionEls.length;
        optionEls[nextIndex]?.focus();
    };

    // stopPropagation keeps the enclosing View popover and app-wide shortcut
    // handlers (some registered at the capture phase) from reacting to keys the
    // open listbox consumes — the listbox is portaled outside any ancestor.
    const handleDropdownKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeDropdown();
            return;
        }
        if (event.key === 'Tab') {
            // Close and hand enfoque back to the trigger, then let the browser move
            // enfoque naturally from there — no preventDefault, so Tab/Shift+Tab
            // no leave the listbox visibly open while enfoque walks the portal.
            closeDropdown();
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            focusOption(1);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            focusOption(-1);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            const active = document.activeElement as HTMLElement | null;
            const next = active?.dataset.value;
            if (next != null && active?.getAttribute('aria-disabled') !== 'true') {
                selectValue(next);
            }
        }
    };

    return (
        <div ref={containerRef} className={cn('relative', className)}>
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-label={label}
                onClick={() => setOpen((prev) => !prev)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        closeDropdown();
                        return;
                    }
                    if (
                        !open &&
                        (event.key === 'ArrowDown' ||
                            event.key === 'ArrowUp' ||
                            event.key === 'Enter' ||
                            event.key === ' ')
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(true);
                    }
                }}
                className={cn(TOOLBAR_SELECT_TRIGGER, className)}
            >
                {icon}
                <span className={TOOLBAR_SELECT_LABEL}>{label}</span>
                <span className={TOOLBAR_SELECT_VALUE}>{selected?.label ?? ''}</span>
                <ChevronDown
                    className={cn(
                        'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform',
                        open && 'rotate-180',
                    )}
                    aria-hidden="true"
                />
            </button>
            {open && (
                <ModalPortal>
                    <div
                        ref={dropdownRef}
                        data-selector-dropdown="true"
                        style={{ ...fixedDropdownStyle, width: 'max-content', minWidth: fixedDropdownStyle.width }}
                        className="z-[70] rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-1 text-xs"
                        onKeyDown={handleDropdownKeyDown}
                    >
                        <div role="listbox" id={listboxId} aria-label={label}>
                            {options.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="option"
                                    data-selector-option="true"
                                    data-value={option.value}
                                    aria-selected={option.value === value}
                                    aria-disabled={option.disabled || undefined}
                                    tabIndex={-1}
                                    onClick={() => {
                                        if (option.disabled) return;
                                        selectValue(option.value);
                                    }}
                                    className={cn(
                                        // `block` matters: inline-block buttons with percentage width
                                        // blow up the popup's max-content width in Chromium.
                                        'block w-full text-left px-2 py-1 rounded focus:outline-none',
                                        option.disabled
                                            ? 'cursor-default text-muted-foreground opacity-50'
                                            : 'hover:bg-muted/50 focus:bg-muted/50',
                                        !option.disabled && option.value === value && 'bg-muted/70',
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </ModalPortal>
            )}
        </div>
    );
}

function enabledOptionEls(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(
        root.querySelectorAll<HTMLButtonElement>('[data-selector-option="true"]:not([aria-disabled="true"])'),
    );
}
