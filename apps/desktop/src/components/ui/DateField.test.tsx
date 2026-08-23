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
        // The visual cue is immediate, but a half-typed date is unparseable on
        // nearly every keystroke — announcing "invalid" that often is noise, so
        // aria-invalid waits until the field is left.
        expect(input.className).toContain('border-warning');
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(onDateChange).not.toHaveBeenCalled();

        fireEvent.blur(input);
        expect(input).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(input, { target: { value: '04/20/2026' } });
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(input.className).not.toContain('border-warning');
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

    it('completes year-less and 2-digit-year entry only when leaving the field (#1050)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 7, 22));
        try {
            const onDateChange = vi.fn();
            render(
                <DateField
                    t={t}
                    dateAriaLabel="Due"
                    dateValue="2026-04-19"
                    selectedDate={new Date(2026, 3, 19)}
                    dateFormatSetting="mdy"
                    nativeDateInputLocale="en-US"
                    dateInputClassName="border"
                    onDateChange={onDateChange}
                />
            );

            const input = screen.getByLabelText('Due') as HTMLInputElement;
            // Never mid-typing: completing "1/1" on the keystroke rewrote the
            // text under the user and made "1/1/27" impossible to type.
            fireEvent.change(input, { target: { value: '1/1' } });
            expect(onDateChange).not.toHaveBeenCalled();
            expect(input.className).not.toContain('border-warning');
            fireEvent.blur(input);
            await waitFor(() => expect(onDateChange).toHaveBeenLastCalledWith('2027-01-01'));

            // Still ahead this year, so no rollover.
            onDateChange.mockClear();
            fireEvent.change(input, { target: { value: '12/25' } });
            fireEvent.blur(input);
            await waitFor(() => expect(onDateChange).toHaveBeenLastCalledWith('2026-12-25'));

            onDateChange.mockClear();
            fireEvent.change(input, { target: { value: '1/1/27' } });
            expect(onDateChange).not.toHaveBeenCalled();
            fireEvent.blur(input);
            await waitFor(() => expect(onDateChange).toHaveBeenLastCalledWith('2027-01-01'));

            // A complete date still applies while typing, no blur needed.
            onDateChange.mockClear();
            fireEvent.change(input, { target: { value: '04/20/2026' } });
            expect(onDateChange).toHaveBeenLastCalledWith('2026-04-20');
        } finally {
            vi.useRealTimers();
        }
    });

    it('reads year-less entry day-first under a d/m/y format, and still rejects 31/2', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 7, 22));
        try {
            const onDateChange = vi.fn();
            render(
                <DateField
                    t={t}
                    dateAriaLabel="Due"
                    dateValue="2026-04-19"
                    selectedDate={new Date(2026, 3, 19)}
                    dateFormatSetting="dmy"
                    nativeDateInputLocale="en-GB"
                    dateInputClassName="border"
                    onDateChange={onDateChange}
                />
            );

            const input = screen.getByLabelText('Due') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '20/4' } });
            expect(onDateChange).not.toHaveBeenCalled();
            fireEvent.blur(input);
            await waitFor(() => expect(onDateChange).toHaveBeenLastCalledWith('2027-04-20'));

            onDateChange.mockClear();
            fireEvent.change(input, { target: { value: '31/2' } });
            expect(onDateChange).not.toHaveBeenCalled();
            expect(input.className).toContain('border-warning');
            // An unparseable draft still reverts to the saved value on leave.
            fireEvent.blur(input);
            await waitFor(() => expect(input.value).toBe('19/04/2026'));
            expect(onDateChange).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
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
