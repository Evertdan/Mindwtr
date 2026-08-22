import { describe, expect, it } from 'vitest';

import { formatTaskMarkedDoneMessage, formatTaskMovedMessage } from './undo-task-completion';

// The two keys ship with different placeholder conventions ('{title}' vs
// '{{title}}'); the formatters interpret the keys as they are, so both platforms
// get the same text from one home instead of hand-rolling a `.replace` each.
describe('task action toast text', () => {
    const passthrough = (key: string) => key;

    it('falls back to English when the key is missing', () => {
        expect(formatTaskMarkedDoneMessage(passthrough, 'File taxes')).toBe('File taxes marked Done');
        expect(formatTaskMovedMessage(passthrough, 'File taxes', 'waiting'))
            .toBe('File taxes moved to waiting');
    });

    it('fills a translated template and the translated status name', () => {
        const t = (key: string) => (
            key === 'task.markedDone' ? '{title} erledigt'
                : key === 'task.movedToStatus' ? '{{title}} nach {{status}} verschoben'
                    : key === 'status.waiting' ? 'Wartend'
                        : key
        );
        expect(formatTaskMarkedDoneMessage(t, 'Steuern')).toBe('Steuern erledigt');
        expect(formatTaskMovedMessage(t, 'Steuern', 'waiting')).toBe('Steuern nach Wartend verschoben');
    });
});
