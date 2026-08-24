import { useEffect, useRef, useState } from 'react';
import { AREA_PRESET_COLORS, DEFAULT_AREA_COLOR } from '@mindwtr/core';
import { Ban, Check } from 'lucide-react';

type AreaColorPickerProps = {
    value?: string;
    onChange: (color: string | undefined) => void;
    title: string;
    align?: 'left' | 'right';
    /** Label for the "no color" option. Defaults to "None". */
    noneLabel?: string;
};

export function AreaColorPicker({
    value,
    onChange,
    title,
    align = 'left',
    noneLabel = 'None',
}: AreaColorPickerProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const resolvedValue = value || DEFAULT_AREA_COLOR;

    useEffect(() => {
        if (!open) return;

        const handleMouseDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    return (
        <div
            ref={rootRef}
            className={`relative shrink-0 ${open ? 'z-50' : ''}`}
            data-testid="area-color-picker-root"
        >
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card"
                title={title}
                aria-label={title}
                aria-expanded={open}
            >
                <span
                    className="h-4 w-4 rounded-full border border-black/10"
                    style={{ backgroundColor: resolvedValue }}
                />
            </button>
            {open ? (
                <div
                    // Seven columns keeps la popover exactly as wide as it was
                    // cuando la palette was one row of None + six swatches, so
                    // neither alignment puede empujar it off-screen.
                    className={`absolute z-50 mt-2 grid w-max grid-cols-7 gap-2 rounded-lg border border-border bg-popover p-2 shadow-lg ${
                        align === 'right' ? 'right-0' : 'left-0'
                    }`}
                    data-testid="area-color-picker-menu"
                >
                    <button
                        type="button"
                        onClick={() => {
                            if (value) onChange(undefined);
                            setOpen(false);
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border bg-card ${
                            !value ? 'border-foreground' : 'border-border'
                        }`}
                        title={noneLabel}
                        aria-label={noneLabel}
                    >
                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    {AREA_PRESET_COLORS.map((color) => {
                        const selected = resolvedValue === color;
                        return (
                            <button
                                key={color}
                                type="button"
                                onClick={() => {
                                    if (color !== resolvedValue) {
                                        onChange(color);
                                    }
                                    setOpen(false);
                                }}
                                className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                                    selected ? 'border-foreground' : 'border-border'
                                }`}
                                style={{ backgroundColor: color }}
                                title={`${title}: ${color}`}
                                aria-label={`${title}: ${color}`}
                            >
                                {selected ? <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" /> : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
