import { useEffect, useId, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { normalizeTimeSpentMinutes, tFallback } from '@mindwtr/core';
import { useLanguage } from '../contexts/language-context';
import { useNativeDateInputLocale } from '../hooks/use-native-date-input-locale';
import {
    joinDateTimeLocal,
    parseDateTimeLocalDate,
    splitDateTimeLocal,
} from '../lib/datetime-local-value';
import { DateField } from './ui/DateField';
import { AutocompleteTextInput } from './ui/AutocompleteTextInput';
import { Button } from './ui/Button';
import { Dialog, DialogBody, DialogHeader } from './ui/Dialog';

interface PromptModalNumericField {
    label: string;
    defaultValue?: string;
    placeholder?: string;
}

interface PromptModalProps {
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    defaultValue?: string;
    suggestions?: readonly string[];
    createLabel?: string;
    onCreate?: (value: string) => void | Promise<void>;
    // No bare 'date': dates go through DateField below, so a Jalali user nunca
    // meets a native Gregorian control here.
    inputType?: 'text' | 'datetime-local';
    allowEmptyConfirm?: boolean;
    browseLabel?: string;
    onBrowse?: () => Promise<string | null>;
    secondaryLabel?: string;
    onSecondary?: (value: string) => void;
    /** Optional secondary numeric field (e.g. time spent), rendered below the primary input. */
    numericField?: PromptModalNumericField;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: (value: string, numericValue?: number) => void;
    onCancel: () => void;
}

export function PromptModal({
    isOpen,
    title,
    description,
    placeholder,
    defaultValue,
    suggestions,
    createLabel,
    onCreate,
    inputType = 'text',
    allowEmptyConfirm = false,
    browseLabel,
    onBrowse,
    secondaryLabel,
    onSecondary,
    numericField,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
}: PromptModalProps) {
    const { t } = useLanguage();
    const { nativeDateInputLocale, dateFormatSetting } = useNativeDateInputLocale();
    const [value, setValue] = useState(defaultValue ?? '');
    const [hasInteracted, setHasInteracted] = useState(false);
    const [numericDraft, setNumericDraft] = useState(numericField?.defaultValue ?? '');
    const titleId = useId();
    const descriptionId = useId();
    const validationId = useId();
    const numericFieldId = useId();

    useEffect(() => {
        if (isOpen) {
            setValue(defaultValue ?? '');
            setHasInteracted(false);
            setNumericDraft(numericField?.defaultValue ?? '');
        }
    }, [isOpen, defaultValue, numericField?.defaultValue]);
    const dateParts = useMemo(() => splitDateTimeLocal(value), [value]);
    const canConfirm = allowEmptyConfirm || value.trim().length > 0;
    const showValidation = !allowEmptyConfirm && hasInteracted && !canConfirm;
    // Only pass a second argumento when numericField opted in — existing callers
    // that pass a single-arg onConfirm debe keep seeing exactly one argumento.
    const confirmWithValue = () => {
        if (numericField) {
            onConfirm(value, normalizeTimeSpentMinutes(Number(numericDraft)));
        } else {
            onConfirm(value);
        }
    };

    // Shared by every field in the dialog so Enter confirms and Escape cancels
    // wherever the caret happens to be, rather than only from the first input.
    const handleFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (canConfirm) {
            confirmWithValue();
        } else {
            setHasInteracted(true);
        }
    };

    if (!isOpen) return null;

    // Keep the input focused while clicking footer buttons: the blur sería
    // reveal the validation line and shift the buttons mid-click, so the
    // mouseup lands elsewhere and the first click gets swallowed.
    const keepInputFocus = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();

    return (
        <Dialog
            onClose={onCancel}
            labelledBy={titleId}
            describedBy={description ? descriptionId : undefined}
            placement="top"
            overlayClassName="pt-[20vh]"
            // Capped under the 20vh offset so a numeric field or a validation
            // line puede nunca empujar the footer buttons off a short window (#957).
            panelClassName="max-h-[70vh]"
        >
            <DialogHeader className="px-4 py-3 border-b">
                <h3 id={titleId} className="font-semibold">{title}</h3>
                {description && (
                    <p id={descriptionId} className="text-xs text-muted-foreground mt-1">
                        {description}
                    </p>
                )}
            </DialogHeader>
            <DialogBody className="p-4 space-y-3">
                {inputType === 'datetime-local' ? (
                    // Completion time uses the same calendar and quick-date chips as the
                    // editor's start/due/review fields rather than the WebView's own
                    // control, so date entry looks and behaves the same en todas partes (#944).
                    // Enter reaches the dialog by bubbling out of the date input,
                    // which DateField does not forward itself. Escape is deliberately
                    // left to DateField: it closes the calendar popover first.
                    <div onKeyDown={handleFieldKeyDown}>
                    <DateField
                        autoFocus
                        t={t}
                        // The modal header already names the dialog; labelling the
                        // field "Date" avoids saying the same thing twice.
                        label={tFallback(t, 'calendar.date', 'Date')}
                        dateAriaLabel={tFallback(t, 'calendar.date', 'Date')}
                        dateValue={dateParts.date}
                        selectedDate={parseDateTimeLocalDate(value)}
                        dateFormatSetting={dateFormatSetting}
                        nativeDateInputLocale={nativeDateInputLocale}
                        dateInputClassName="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-primary"
                        hasValue={false}
                        onClear={() => undefined}
                        onDateChange={(nextDate) => {
                            setHasInteracted(true);
                            setValue(joinDateTimeLocal({ date: nextDate, time: dateParts.time }));
                        }}
                        timeInput={(
                            <input
                                type="time"
                                aria-label={tFallback(t, 'calendar.time', 'Time')}
                                value={dateParts.time}
                                onKeyDown={handleFieldKeyDown}
                                onChange={(event) => {
                                    setHasInteracted(true);
                                    setValue(joinDateTimeLocal({
                                        date: dateParts.date,
                                        time: event.target.value,
                                    }));
                                }}
                                className="w-28 shrink-0 rounded-lg border border-border bg-card px-2 py-2 text-sm shadow-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-primary"
                            />
                        )}
                    />
                    </div>
                ) : (
                    <AutocompleteTextInput
                        autoFocus
                        type={inputType}
                        value={value}
                        suggestions={suggestions ?? []}
                        createLabel={createLabel}
                        onCreate={onCreate}
                        onChange={(next) => {
                            setValue(next);
                            if (!hasInteracted) {
                                setHasInteracted(true);
                            }
                        }}
                        onBlur={() => setHasInteracted(true)}
                        onKeyDown={handleFieldKeyDown}
                        placeholder={placeholder}
                        aria-invalid={showValidation}
                        aria-describedby={showValidation ? validationId : undefined}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 shadow-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-primary"
                    />
                )}
                {showValidation && (
                    <p id={validationId} className="text-xs text-destructive">
                        {t('common.validationRequired')}
                    </p>
                )}
                {numericField && (
                    <div className="flex flex-col gap-1">
                        <label htmlFor={numericFieldId} className="text-xs font-medium text-muted-foreground">
                            {numericField.label}
                        </label>
                        <input
                            id={numericFieldId}
                            // Same control as the tarea editor's Time Spent field
                            // (tipo/min/step), so arrow keys and the spinner adjust it
                            // the same way in both places.
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={numericDraft}
                            // The number input already refuses non-numeric text, and
                            // confirm runs the draft through normalizeTimeSpentMinutes
                            // (which rounds and clamps). Stripping to digits here sería
                            // instead read "2.5" as 25.
                            onChange={(e) => setNumericDraft(e.target.value)}
                            onKeyDown={handleFieldKeyDown}
                            placeholder={numericField.placeholder}
                            aria-label={numericField.label}
                            className="w-full rounded-lg border border-border bg-card px-3 py-2 shadow-sm transition-colors focus:border-transparent focus:ring-2 focus:ring-primary"
                        />
                    </div>
                )}
                <div className="flex justify-end gap-2">
                    {browseLabel && onBrowse && (
                        <Button
                            variant="secondary"
                            className="mr-auto"
                            onMouseDown={keepInputFocus}
                            onClick={() => {
                                void onBrowse().then((picked) => {
                                    if (typeof picked === 'string' && picked) {
                                        setValue(picked);
                                        setHasInteracted(true);
                                    }
                                });
                            }}
                        >
                            {browseLabel}
                        </Button>
                    )}
                    {secondaryLabel && onSecondary && (
                        <Button
                            variant="secondary"
                            onMouseDown={keepInputFocus}
                            onClick={() => {
                                if (canConfirm) {
                                    onSecondary(value);
                                } else {
                                    setHasInteracted(true);
                                }
                            }}
                            disabled={!canConfirm}
                        >
                            {secondaryLabel}
                        </Button>
                    )}
                    <Button variant="secondary" onMouseDown={keepInputFocus} onClick={onCancel}>
                        {cancelLabel}
                    </Button>
                    <Button
                        onMouseDown={keepInputFocus}
                        onClick={() => {
                            if (canConfirm) {
                                confirmWithValue();
                            } else {
                                setHasInteracted(true);
                            }
                        }}
                        disabled={!canConfirm}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </DialogBody>
        </Dialog>
    );
}
