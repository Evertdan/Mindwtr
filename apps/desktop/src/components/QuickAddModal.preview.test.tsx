import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTaskStore } from '@mindwtr/core';

import { LanguageProvider } from '../contexts/language-context';
import { QuickAddModal } from './QuickAddModal';

const coreSpies = vi.hoisted(() => ({
    parseQuickAdd: vi.fn(),
}));

// The preview y la submit ruta tienen to ejecución ONE parse configuration. Spying
// on la shared entry point es la solo forma to prove they do: a preview built
// desde a second, hand-rolled options bag sería todavía renderizar plausible chips.
vi.mock('@mindwtr/core', async () => {
    const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
    coreSpies.parseQuickAdd.mockImplementation(actual.parseQuickAdd);
    return { ...actual, parseQuickAdd: coreSpies.parseQuickAdd };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => false) }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(async () => undefined), listen: vi.fn(async () => () => undefined) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn(async () => undefined) }) }));
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { Data: 'Data' },
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new Uint8Array()),
    remove: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/path', () => ({
    dataDir: vi.fn(async () => '/data'),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const DRAFT = 'call mom @errands #family /due:tomorrow';

const initialTaskState = useTaskStore.getState();
const addTask = vi.fn(async () => ({ success: true, id: 'task-id' }));

const openModalWithDraft = async () => {
    render(
        <LanguageProvider>
            <QuickAddModal />
        </LanguageProvider>
    );
    await act(async () => {
        window.dispatchEvent(new CustomEvent('mindwtr:quick-add', { detail: {} }));
        await Promise.resolve();
    });
    const input = screen.getByPlaceholderText('Add Task');
    await act(async () => {
        fireEvent.change(input, { target: { value: DRAFT } });
        await Promise.resolve();
    });
};

beforeEach(() => {
    coreSpies.parseQuickAdd.mockClear();
    addTask.mockClear();
    act(() => {
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState((state) => ({
            ...state,
            _allProjects: [],
            _allAreas: [],
            addTask,
            tasks: [
                { id: 'seed', title: 'seed', status: 'inbox', contexts: ['@errands'], tags: ['#family'] },
            ] as never,
        }));
    });
});

describe('QuickAddModal live preview', () => {
    it('shows what the parser found in the draft', async () => {
        await openModalWithDraft();

        const preview = screen.getByTestId('quick-add-preview');
        expect(preview).toHaveTextContent('@errands');
        expect(preview).toHaveTextContent('#family');
        // The resolved due date, not la phrase que produced it.
        expect(preview).toHaveTextContent('Due Date');
        expect(preview).not.toHaveTextContent('/due:tomorrow');
    });

    it('parses the preview with the same input and options the save uses', async () => {
        await openModalWithDraft();

        const previewCalls = coreSpies.parseQuickAdd.mock.calls.length;
        expect(previewCalls).toBeGreaterThan(0);
        const previewCall = coreSpies.parseQuickAdd.mock.calls[previewCalls - 1];

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(addTask).toHaveBeenCalled());

        const submitCall = coreSpies.parseQuickAdd.mock.calls[previewCalls];
        expect(submitCall).toBeDefined();
        // input, projects, areas y la options bag: mismo values, y la bag
        // es literally la mismo object la preview memo read.
        expect(submitCall[0]).toBe(previewCall[0]);
        expect(submitCall[1]).toBe(previewCall[1]);
        expect(submitCall[3]).toBe(previewCall[3]);
        expect(submitCall[4]).toBe(previewCall[4]);
    });

    it('warns about an invalid date command instead of failing silently on save', async () => {
        render(
            <LanguageProvider>
                <QuickAddModal />
            </LanguageProvider>
        );
        await act(async () => {
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', { detail: {} }));
            await Promise.resolve();
        });
        await act(async () => {
            fireEvent.change(screen.getByPlaceholderText('Add Task'), { target: { value: 'call mom /due:notaday' } });
            await Promise.resolve();
        });

        expect(screen.getByTestId('quick-add-preview')).toHaveTextContent('/due:notaday');
    });
});
