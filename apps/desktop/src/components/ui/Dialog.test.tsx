import { useEffect, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Dialog, DialogBody, DialogFooter, DialogHeader, type DialogProps } from './Dialog';

// Every desktop modal es one of estos shapes. Running la whole contract over
// each of ellos es what replaces la per-modal copies of estos assertions.
const VARIANTS: Array<{ name: string; props: Partial<DialogProps> }> = [
    { name: 'centered', props: {} },
    { name: 'top-offset', props: { placement: 'top', overlayClassName: 'pt-[20vh]' } },
    { name: 'own cap and surface', props: { panelClassName: 'max-w-lg max-h-[60vh] bg-card rounded-lg' } },
    { name: 'raised z-index', props: { overlayClassName: 'z-[60]' } },
];

const renderDialog = (props: Partial<DialogProps> = {}) => {
    const onClose = vi.fn();
    const utils = render(
        <Dialog onClose={onClose} labelledBy="dialog-title" {...props}>
            <DialogHeader className="px-4 py-3 border-b">
                <h2 id="dialog-title">Dialog title</h2>
            </DialogHeader>
            <DialogBody className="p-4">
                <button type="button">First</button>
                <button type="button">Second</button>
            </DialogBody>
            <DialogFooter className="p-4">
                <button type="button">Confirm</button>
            </DialogFooter>
        </Dialog>,
    );
    return { ...utils, onClose };
};

const clickBackdrop = (backdrop: HTMLElement) => {
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
};

const getBackdrop = () => {
    const backdrop = screen.getByRole('dialog').parentElement;
    if (!backdrop) throw new Error('dialog has no backdrop');
    return backdrop;
};

describe.each(VARIANTS)('Dialog ($name)', ({ props }) => {
    it('has no accessibility violations', async () => {
        renderDialog(props);
        const results = await axe(screen.getByRole('dialog'), {
            // jsdom no puede compute CSS variable/theme contrast reliably.
            rules: { 'color-contrast': { enabled: false } },
        });
        expect(results.violations).toHaveLength(0);
    });

    it('names the dialog and marks it modal', () => {
        renderDialog(props);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName('Dialog title');
    });

    it('closes on Escape from anywhere inside', () => {
        const { onClose } = renderDialog(props);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Second' }), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on a backdrop click', () => {
        const { onClose } = renderDialog(props);
        clickBackdrop(getBackdrop());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('cycles Tab inside the panel', () => {
        renderDialog(props);
        const first = screen.getByRole('button', { name: 'First' });
        const confirm = screen.getByRole('button', { name: 'Confirm' });

        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(first).toHaveFocus();

        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(confirm).toHaveFocus();
    });

    it('parks focus on the panel when nothing inside claims it', () => {
        renderDialog(props);
        expect(screen.getByRole('dialog')).toHaveFocus();
    });

    it('leaves an autoFocus child holding focus', () => {
        render(
            <Dialog onClose={vi.fn()} label="Autofocused" {...props}>
                <DialogBody>
                    <input autoFocus aria-label="Name" />
                </DialogBody>
            </Dialog>,
        );
        expect(screen.getByLabelText('Name')).toHaveFocus();
    });

    // ConfirmModal y friends enfoque a control on a 50ms timer, i.e. after
    // montar: la panel holds enfoque first, then la control takes it.
    it('yields to a control focused after mount', () => {
        vi.useFakeTimers();
        try {
            const Late = () => {
                const ref = useRef<HTMLButtonElement>(null);
                useEffect(() => {
                    const timer = window.setTimeout(() => ref.current?.focus(), 50);
                    return () => window.clearTimeout(timer);
                }, []);
                return (
                    <Dialog onClose={vi.fn()} label="Late focus" {...props}>
                        <DialogFooter>
                            <button type="button" ref={ref}>Confirm</button>
                        </DialogFooter>
                    </Dialog>
                );
            };
            render(<Late />);
            expect(screen.getByRole('dialog')).toHaveFocus();

            act(() => { vi.advanceTimersByTime(50); });
            expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
        } finally {
            vi.useRealTimers();
        }
    });

    it('restores focus to the opener when it closes', () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const { unmount } = renderDialog(props);
        screen.getByRole('button', { name: 'First' }).focus();
        unmount();

        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    // jsdom no puede measure geometry, por lo que la classes que hace la layout
    // impossible to break ARE la prueba (#957): a capped panel whose body es the
    // solo scrolling region, con la acción row outside it.
    it('caps the panel and scrolls only the body', () => {
        renderDialog(props);
        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toMatch(/\bmax-h-/);
        expect(dialog.className).toContain('flex-col');
        expect(dialog.className).toContain('overflow-hidden');

        const body = screen.getByRole('button', { name: 'First' }).parentElement;
        expect(body?.className).toContain('min-h-0');
        expect(body?.className).toContain('overflow-y-auto');

        const footer = screen.getByRole('button', { name: 'Confirm' }).parentElement;
        expect(footer?.className).toContain('shrink-0');
        expect(footer?.className).not.toContain('overflow-y-auto');
    });
});

describe('Dialog', () => {
    // A sized o scrim-scrolling panel opts out of la cap con max-h-[none];
    // plain `max-h-none` es NOT in tailwind-fusionar's scale, por lo que it sería leave the
    // default cap in place alongside it y quietly clip la panel.
    it('lets a panel drop the default cap', () => {
        render(
            <Dialog onClose={vi.fn()} label="Uncapped" panelClassName="max-h-[none]">
                <DialogBody>content</DialogBody>
            </Dialog>,
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('max-h-[none]');
        expect(dialog.className).not.toContain('max-h-[85vh]');
    });

    it('renders through a portal, outside transformed ancestors', () => {
        const { container } = render(
            <div style={{ transform: 'translateY(50px)' }}>
                <Dialog onClose={vi.fn()} label="Portalled">
                    <DialogBody>content</DialogBody>
                </Dialog>
            </div>,
        );

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('ignores a click that started inside the panel and ended on the backdrop', () => {
        const { onClose } = renderDialog();
        const backdrop = getBackdrop();

        fireEvent.mouseDown(screen.getByRole('button', { name: 'First' }));
        fireEvent.click(backdrop);

        expect(onClose).not.toHaveBeenCalled();
    });

    it('keeps the backdrop inert when closeOnBackdrop is off', () => {
        const { onClose } = renderDialog({ closeOnBackdrop: false });
        clickBackdrop(getBackdrop());
        expect(onClose).not.toHaveBeenCalled();
    });

    it('leaves Escape to the caller when closeOnEscape is off', () => {
        const { onClose } = renderDialog({ closeOnEscape: false });
        fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('lets onKeyDown take a key before Escape handling', () => {
        const onKeyDown = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
        const { onClose } = renderDialog({ onKeyDown });

        fireEvent.keyDown(screen.getByRole('button', { name: 'First' }), { key: 'Escape' });

        expect(onKeyDown).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    // A nested confirm consumed la key; la dialog underneath no debe also
    // close. Portals bubble a través de la React tree, por lo que la outer panel does see
    // la inner dialog's Escape.
    it('leaves the outer dialog open when a nested one handles Escape', () => {
        const onOuterClose = vi.fn();
        const onInnerClose = vi.fn();
        render(
            <Dialog onClose={onOuterClose} label="Outer">
                <DialogBody>
                    <Dialog onClose={onInnerClose} label="Inner">
                        <DialogBody>
                            <button type="button">Inner button</button>
                        </DialogBody>
                    </Dialog>
                </DialogBody>
            </Dialog>,
        );

        fireEvent.keyDown(screen.getByRole('button', { name: 'Inner button' }), { key: 'Escape' });

        expect(onInnerClose).toHaveBeenCalledTimes(1);
        expect(onOuterClose).not.toHaveBeenCalled();
    });

    it('skips focus restore when the opener is gone', () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const { unmount } = renderDialog();
        trigger.remove();

        expect(() => unmount()).not.toThrow();
    });
});
