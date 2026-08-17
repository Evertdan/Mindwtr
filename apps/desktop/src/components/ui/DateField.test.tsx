/**
 * DateField is the one desktop date input (see DateField.tsx). These cover the
 * two things the extraction had to keep working everywhere it is now adopted:
 * the calendar popover escaping a Dialog-hosted parent, and the label/clear
 * chrome staying optional for hosts that supply their own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JALALI_LOCALE_TAG } from '@mindwtr/core';

import { Dialog, DialogBody } from './Dialog';
import { DateField } from './DateField';

const translations: Record<string, string> = {
    'calendar.date': 'Date',
    'calendar.nextMonth': 'Next month',
    'calendar.prevMonth': 'Previous month',
    'common.clear': 'Clear',
    'nav.calendar': 'Calendar',
    'taskEdit.dateOnly': 'Date only',
};

const t = (key: string) => translations[key] ?? key;

afterEach(() => {
    cleanup();
});

describe('DateField', () => {
    it('opens its calendar popover from inside a Dialog', () => {
        // The popover is position:fixed rather than its own portal, so a Dialog
        // panel's overflow-hidden must not be allowed to swallow it. jsdom
        // cannot measure the escape; asserting it mounts under the panel is the
        // part a test can pin.
        render(
            <Dialog onClose={vi.fn()} label="Host dialog">
                <DialogBody>
                    <DateField
                        t={t}
                        label="Due"
                        dateAriaLabel="Due"
                        dateValue="2026-04-19"
                        selectedDate={new Date(2026, 3, 19)}
                        nativeDateInputLocale="en-US"
                        dateInputClassName="border"
                        hasValue
                        onDateChange={vi.fn()}
                        onClear={vi.fn()}
                    />
                </DialogBody>
            </Dialog>
        );

        expect(screen.queryByRole('dialog', { name: 'Due Calendar' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Due Calendar' }));

        const popover = screen.getByRole('dialog', { name: 'Due Calendar' });
        expect(popover).toBeTruthy();
        expect(screen.getByRole('dialog', { name: 'Host dialog' }).contains(popover)).toBe(true);
    });

    it('drops the label and the clear control when the host owns them', () => {
        const { container } = render(
            <DateField
                t={t}
                dateAriaLabel="Ends on"
                dateValue="2026-04-19"
                selectedDate={new Date(2026, 3, 19)}
                nativeDateInputLocale="en-US"
                dateInputClassName="border"
                onDateChange={vi.fn()}
            />
        );

        expect(container.querySelector('label')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear Ends on' })).toBeNull();
        expect(screen.getByLabelText('Ends on')).toBeTruthy();
    });

    it('marks unparseable typed text invalid without committing it (#1050)', () => {
        const onDateChange = vi.fn();
        render(
            <DateField
                t={t}
                label="Due"
                dateAriaLabel="Due"
                dateValue="2026-04-19"
                selectedDate={new Date(2026, 3, 19)}
                nativeDateInputLocale="en-US"
                dateInputClassName="border"
                hasValue
                onDateChange={onDateChange}
                onClear={vi.fn()}
            />
        );

        const input = screen.getByRole('textbox', { name: 'Due' });
        fireEvent.change(input, { target: { value: 'saasdjfasdj' } });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(onDateChange).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: '04/20/2026' } });
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(onDateChange).toHaveBeenCalledWith('2026-04-20');
    });

    it('typing the field empty reverts on blur when the host passes no onClear', async () => {
        const onDateChange = vi.fn();
        render(
            <DateField
                t={t}
                dateAriaLabel="Ends on"
                dateValue="2026-04-19"
                selectedDate={new Date(2026, 3, 19)}
                nativeDateInputLocale="en-US"
                dateInputClassName="border"
                onDateChange={onDateChange}
            />
        );

        const input = screen.getByLabelText('Ends on') as HTMLInputElement;
        expect(input.value).toBe('04/19/2026');

        fireEvent.change(input, { target: { value: '' } });
        expect(onDateChange).not.toHaveBeenCalled();

        // The reset is deferred past any in-flight pointer press (#901).
        fireEvent.blur(input);
        await waitFor(() => expect(input.value).toBe('04/19/2026'));
    });

    it('shows and parses Jalali dates when the resolved locale is the Persian calendar', () => {
        const onDateChange = vi.fn();
        render(
            <DateField
                t={t}
                dateAriaLabel="Due"
                dateValue="2026-04-19"
                selectedDate={new Date(2026, 3, 19)}
                nativeDateInputLocale={JALALI_LOCALE_TAG}
                dateInputClassName="border"
                onDateChange={onDateChange}
            />
        );

        const input = screen.getByLabelText('Due') as HTMLInputElement;
        expect(input.value).toBe('1405-01-30');

        fireEvent.change(input, { target: { value: '1405-02-01' } });
        expect(onDateChange).toHaveBeenCalledWith('2026-04-21');
    });
});
