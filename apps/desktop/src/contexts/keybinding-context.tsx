import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { shallow, useTaskStore } from '@mindwtr/core';
import { useLanguage } from './language-context';
import { KeybindingHelpModal } from '../components/KeybindingHelpModal';
import { isFlatpakRuntime, isTauriRuntime } from '../lib/runtime';
import { reportError } from '../lib/report-error';
import { nextDensityMode } from '../lib/density';
import { takeUndoableAction } from '../lib/undo-registry';
import { logWarn } from '../lib/app-log';
import { useUiStore } from '../store/ui-store';
import { saveStoredFullscreen } from '../lib/window-state';
import {
    applyGlobalQuickAddShortcut,
    type GlobalQuickAddShortcutSetting,
    matchesGlobalQuickAddShortcut,
    normalizeGlobalQuickAddShortcut,
} from '../lib/global-quick-add-shortcut';
import { areaFilterSelectionToFilters } from '@mindwtr/core';
import type { TaskStatus } from '@mindwtr/core';

export type KeybindingStyle = 'vim' | 'emacs' | 'standard';

function isKeybindingStyle(value: unknown): value is KeybindingStyle {
    return value === 'vim' || value === 'emacs' || value === 'standard';
}

export interface TaskListScope {
    kind: 'taskList';
    selectNext: () => void;
    selectPrev: () => void;
    selectFirst: () => void;
    selectLast: () => void;
    editSelected: () => void;
    openSelected?: () => void;
    openQuickActions?: () => void;
    toggleDoneSelected: () => void;
    toggleSelectSelected?: () => void;
    toggleFocusSelected?: () => void;
    renameSelected?: () => void;
    deleteSelected: () => void;
    setStatusSelected?: (status: TaskStatus) => void;
    focusAddInput?: () => boolean;
    // Move DOM enfoque onto la currently selected tarea's title y renderizar its
    // highlight, por lo que entering la list desde la sidebar (ArrowRight / `l`)
    // selects a tarea en lugar de focusing la scroll container (#890). Returns
    // false cuando ahí es no tarea to select por lo que la caller puede fall back to
    // focusing la main-content container.
    focusSelected?: () => boolean;
}

// Status chord: `s` then a letter sets la selected tarea's status (#860).
// Letters mirror la g-navigation chords (gi/gn/gw/gs/gd/ga).
const STATUS_CHORD_MAP: Record<string, TaskStatus> = {
    i: 'inbox',
    n: 'next',
    w: 'waiting',
    s: 'someday',
    d: 'done',
    a: 'archived',
};

interface KeybindingContextType {
    style: KeybindingStyle;
    setStyle: (style: KeybindingStyle) => void;
    quickAddShortcut: GlobalQuickAddShortcutSetting;
    setQuickAddShortcut: (shortcut: GlobalQuickAddShortcutSetting) => void;
    registerTaskListScope: (scope: TaskListScope | null) => void;
    openHelp: () => void;
}

const KeybindingContext = createContext<KeybindingContextType | undefined>(undefined);

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

// An abierto modal dialog (global search, quick agregar, prompts) owns la keyboard:
// list shortcuts debe nunca act on la view behind it. Without esto, a stray
// Enter o 'e' con enfoque outside la dialog's input completed a tarea in the
// background enfoque list desde inside search (same clase as la #848 menu fix).
function hasModalDialogOpen(): boolean {
    return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

// Enter debe mantener activating whatever control actually has enfoque (buttons,
// menu items, links); la list-level Enter binding solo fires cuando nothing
// interactive es focused.
function hasInteractiveFocus(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return Boolean(active.closest(
        'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="link"], [contenteditable="true"]'
    ));
}

function hasTaskRowFocus(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.closest('[data-task-id]') !== null;
}

function moveSidebarFocus(target: EventTarget | null, direction: 'next' | 'prev'): boolean {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const origin = active ?? (target instanceof HTMLElement ? target : null);
    if (!origin) return false;
    const sidebar = origin.closest('[data-sidebar-nav]');
    if (!sidebar) return false;
    const items = Array.from(sidebar.querySelectorAll<HTMLElement>('[data-sidebar-item]'));
    if (items.length === 0) return false;
    const currentIndex = active ? items.findIndex((item) => item === active) : -1;
    const nextIndex = currentIndex >= 0
        ? direction === 'next'
            ? Math.min(items.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1)
        : direction === 'next'
            ? 0
            : items.length - 1;
    items[nextIndex]?.focus();
    return true;
}

function focusSidebarCurrentView(view: string): boolean {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-item]'));
    if (items.length === 0) return false;
    const match = items.find((item) => item.dataset.view === view) ?? items[0];
    match?.focus();
    return Boolean(match);
}

function focusMainContent(): boolean {
    const main = document.querySelector<HTMLElement>('[data-main-content]');
    if (!main) return false;
    main.focus();
    return true;
}

function triggerGlobalSearch() {
    const isMacPlatform = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
    const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: isMacPlatform,
        ctrlKey: !isMacPlatform,
        bubbles: true,
    });
    window.dispatchEvent(event);
}

function triggerQuickAdd() {
    window.dispatchEvent(new Event('mindwtr:quick-add'));
}

// Click la current view's visible agregar-tarea affordance por lo que a keyboard agregar
// inherits its contexto — a project view's trigger presets que project —
// en lugar de siempre landing in la Inbox (#978).
function clickVisibleAddTaskTrigger(): boolean {
    const root = document.querySelector<HTMLElement>('[data-main-content]') ?? document.body;
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-add-task-trigger]'))
        .find((element) => {
            if ('disabled' in element && Boolean((element as HTMLButtonElement).disabled)) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
    if (!target) return false;
    target.focus();
    target.click();
    return true;
}

function getAppScopedShortcutKey(event: KeyboardEvent): string {
    if (event.key.length !== 1) return event.key;
    // Caps candado reports 'A' sin Shift; decide la a/A pair by Shift alone
    // por lo que Caps candado doesn't arm la area chord en lugar de quick agregar (#865).
    if (event.key.toLowerCase() === 'a') return event.shiftKey ? 'A' : 'a';
    return event.key;
}

// A modifier pressed mid-chord (re-pressing Shift antes de la digit) no debe
// consume y cancel la pendiente chord (#865).
const CHORD_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

function getAreaChordKey(event: KeyboardEvent): string {
    // Users a menudo hold Shift desde la chord prefix en la digit (Shift+1
    // reports '!'), y algunos layouts put digits on shifted keys. Read the
    // digit desde la physical key por lo que la chord todavía lands (#865).
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)?.[1];
    return digit ?? event.key;
}

function triggerTaskEditCancel(taskId: string) {
    const CancelEvent = typeof window.CustomEvent === 'function' ? window.CustomEvent : CustomEvent;
    window.dispatchEvent(new CancelEvent('mindwtr:cancel-task-edit', { detail: { taskId } }));
}

export function KeybindingProvider({
    children,
    currentView,
    onNavigate,
}: {
    children: React.ReactNode;
    currentView: string;
    onNavigate: (view: string) => void;
}) {
    const isTest = import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test';
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent);
    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
    const { areas, settings, updateSettings } = useTaskStore(
        (state) => ({
            areas: state.areas,
            settings: state.settings,
            updateSettings: state.updateSettings,
        }),
        shallow
    );
    const { t } = useLanguage();
    const toggleFocusMode = useUiStore((state) => state.toggleFocusMode);
    const showToast = useUiStore((state) => state.showToast);
    const listOptions = useUiStore((state) => state.listOptions);
    const setListOptions = useUiStore((state) => state.setListOptions);
    const collapseAllTaskDetails = useUiStore((state) => state.collapseAllTaskDetails);
    const editingTaskId = useUiStore((state) => state.editingTaskId);
    const editingTaskIdRef = useRef<string | null>(editingTaskId);

    const initialStyle: KeybindingStyle = isKeybindingStyle(settings.keybindingStyle)
        ? settings.keybindingStyle
        : 'vim';
    const [style, setStyleState] = useState<KeybindingStyle>(initialStyle);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const quickAddShortcut = useMemo(
        () => normalizeGlobalQuickAddShortcut(settings.globalQuickAddShortcut, {
            isFlatpak: isFlatpakRuntime(),
            isMac,
            isWindows,
        }),
        [isMac, isWindows, settings.globalQuickAddShortcut]
    );
    const sortedAreas = useMemo(
        () => [...areas].sort((a, b) => a.order - b.order),
        [areas],
    );

    const isSidebarCollapsed = settings.sidebarCollapsed ?? false;
    const toggleSidebar = useCallback(() => {
        updateSettings({ sidebarCollapsed: !isSidebarCollapsed }).catch((error) => reportError('Failed to update settings', error));
    }, [updateSettings, isSidebarCollapsed]);
    const toggleListDetails = useCallback(() => {
        if (listOptions.showDetails) {
            collapseAllTaskDetails();
            setListOptions({ showDetails: false });
            return;
        }
        setListOptions({ showDetails: true });
    }, [collapseAllTaskDetails, listOptions.showDetails, setListOptions]);
    const toggleDensity = useCallback(() => {
        updateSettings({ appearance: { density: nextDensityMode(settings.appearance?.density) } })
            .catch((error) => reportError('Failed to update density', error));
    }, [settings.appearance?.density, updateSettings]);
    const applyAreaFilterShortcut = useCallback((key: string): boolean => {
        const applySelection = (included: string[]) => {
            updateSettings({
                filters: {
                    ...(useTaskStore.getState().settings?.filters ?? {}),
                    ...areaFilterSelectionToFilters({ included, excluded: [] }),
                },
            }).catch((error) => reportError('Failed to update area filter', error));
        };

        if (key === '0') {
            applySelection([]);
            return true;
        }

        if (!/^[1-9]$/.test(key)) return false;

        const areaIndex = Number(key) - 1;
        const targetArea = sortedAreas[areaIndex];
        if (!targetArea) return false;

        applySelection([targetArea.id]);
        return true;
    }, [sortedAreas, updateSettings]);

    const scopeRef = useRef<TaskListScope | null>(null);
    const pendingRef = useRef<{ key: string | null; timestamp: number }>({ key: null, timestamp: 0 });

    useEffect(() => {
        if (isTest) return;
        const nextStyle = settings.keybindingStyle;
        if (isKeybindingStyle(nextStyle)) {
            setStyleState((prev) => (prev === nextStyle ? prev : nextStyle));
        }
    }, [isTest, settings.keybindingStyle]);

    useEffect(() => {
        editingTaskIdRef.current = editingTaskId;
    }, [editingTaskId]);

    const setStyle = useCallback((next: KeybindingStyle) => {
        setStyleState(next);
        updateSettings({ keybindingStyle: next }).catch((error) => reportError('Failed to update settings', error));
    }, [updateSettings]);
    const setQuickAddShortcut = useCallback((shortcut: GlobalQuickAddShortcutSetting) => {
        updateSettings({ globalQuickAddShortcut: shortcut }).catch((error) => reportError('Failed to update settings', error));
    }, [updateSettings]);

    const registerTaskListScope = useCallback((scope: TaskListScope | null) => {
        scopeRef.current = scope;
    }, []);

    // Every tarea list decision — que tarea es selected, what a key does to it —
    // belongs to a registered TaskListScope built desde la view's own ordered
    // tarea array (see `views/list/tarea-list-scope.ts`). A view que no puede
    // supply one (the calendar grid) registers nothing y keeps a single
    // last-resort affordance: entering la list focuses la first tarea row so
    // Tab/Enter todavía reach it (#890).
    const focusFirstTaskRow = useCallback((): boolean => {
        const root = document.querySelector<HTMLElement>('[data-main-content]') ?? document.body;
        const row = root.querySelector<HTMLElement>('[data-task-id]');
        if (!row) return false;
        row.scrollIntoView?.({ block: 'nearest' });
        // A comma selector returns la first match in document order, que is
        // la done button — Enter sería then complete la tarea (#847). Prefer
        // la title toggle por lo que Enter opens la tarea instead.
        const focusTarget = row.querySelector<HTMLElement>('[data-task-view-toggle]')
            ?? row.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
        if (!focusTarget) return false;
        focusTarget.focus();
        return true;
    }, []);

    // Entering la list desde la sidebar (ArrowRight / `l`) debería enfoque the
    // selected tarea, not la scroll container — focusing la container painted
    // its enfoque ring around la whole list y left no tarea visibly selected
    // (#890). Fall back to la container solo cuando ahí es no tarea to select.
    const focusActiveSelection = useCallback((): boolean => {
        if (scopeRef.current?.focusSelected?.()) return true;
        if (focusFirstTaskRow()) return true;
        return focusMainContent();
    }, [focusFirstTaskRow]);

    const openHelp = useCallback(() => setIsHelpOpen(true), []);
    const toggleFullscreen = useCallback(async () => {
        if (!isTauriRuntime()) return;
        try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const current = getCurrentWindow();
            const isFullscreen = await current.isFullscreen();
            const nextFullscreen = !isFullscreen;
            await current.setFullscreen(nextFullscreen);
            saveStoredFullscreen(nextFullscreen, localStorage);
        } catch (error) {
            void logWarn('Failed to toggle fullscreen', {
                scope: 'keybinding',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
        }
    }, []);

    const vimGoMap = useMemo<Record<string, string>>(() => ({
        i: 'inbox',
        n: 'next',
        f: 'agenda',
        p: 'projects',
        c: 'contexts',
        r: 'review',
        e: 'reference',
        w: 'waiting',
        s: 'someday',
        l: 'calendar',
        b: 'board',
        d: 'done',
        a: 'archived',
    }), []);

    const emacsAltMap = useMemo<Record<string, string>>(() => ({
        i: 'inbox',
        n: 'next',
        a: 'agenda',
        p: 'projects',
        c: 'contexts',
        r: 'review',
        e: 'reference',
        w: 'waiting',
        s: 'someday',
        l: 'calendar',
        b: 'board',
        d: 'done',
        A: 'archived',
    }), []);

    useEffect(() => {
        const handleVim = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'F11') {
                if (isTauriRuntime()) {
                    e.preventDefault();
                    void toggleFullscreen();
                }
                return;
            }
            if (editingTaskIdRef.current) return;
            if (isEditableTarget(e.target)) return;
            if (hasModalDialogOpen()) return;

            const scope = scopeRef.current;
            const now = Date.now();
            if (pendingRef.current.key && now - pendingRef.current.timestamp > 700) {
                pendingRef.current.key = null;
            }

            const pending = pendingRef.current.key;
            if (pending) {
                if (CHORD_MODIFIER_KEYS.has(e.key)) return;
                e.preventDefault();
                if (pending === 'g') {
                    if (e.key === 'g') {
                        scope?.selectFirst();
                    } else if (vimGoMap[e.key]) {
                        onNavigate(vimGoMap[e.key]);
                    }
                } else if (pending === 'A') {
                    applyAreaFilterShortcut(getAreaChordKey(e));
                } else if (pending === 'd') {
                    if (e.key === 'd') {
                        scope?.deleteSelected();
                    }
                }
                pendingRef.current.key = null;
                return;
            }

            switch (e.key) {
                case 'j':
                    if (moveSidebarFocus(e.target, 'next')) {
                        e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    scope?.selectNext();
                    break;
                case 'k':
                    if (moveSidebarFocus(e.target, 'prev')) {
                        e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    scope?.selectPrev();
                    break;
                case 'h':
                    if (focusSidebarCurrentView(currentView)) {
                        e.preventDefault();
                    }
                    break;
                case 'l':
                    if (focusActiveSelection()) {
                        e.preventDefault();
                    }
                    break;
                case 'G':
                    e.preventDefault();
                    scope?.selectLast();
                    break;
                case 'e':
                    e.preventDefault();
                    scope?.editSelected();
                    break;
                case '.':
                    e.preventDefault();
                    scope?.openQuickActions?.();
                    break;
                case 'x':
                    e.preventDefault();
                    scope?.toggleDoneSelected();
                    break;
                case 'Enter':
                    if (hasInteractiveFocus()) break;
                    e.preventDefault();
                    scope?.openSelected?.();
                    break;
                case '/':
                    e.preventDefault();
                    triggerGlobalSearch();
                    break;
                case '?':
                    e.preventDefault();
                    setIsHelpOpen(true);
                    break;
                case 'g':
                case 'd':
                    e.preventDefault();
                    pendingRef.current = { key: e.key, timestamp: now };
                    break;
                default:
                    break;
            }
        };

        // Gmail/Superhuman/Todoist-style tarea-acción cluster: e done, x select,
        // Enter open, z undo, # eliminar. Navigation matches la Vim preset since
        // Gmail uses j/k y g-chords too.
        const handleStandard = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'F11') {
                if (isTauriRuntime()) {
                    e.preventDefault();
                    void toggleFullscreen();
                }
                return;
            }
            if (editingTaskIdRef.current) return;
            if (isEditableTarget(e.target)) return;
            if (hasModalDialogOpen()) return;

            const scope = scopeRef.current;
            const now = Date.now();
            if (pendingRef.current.key && now - pendingRef.current.timestamp > 700) {
                pendingRef.current.key = null;
            }

            const pending = pendingRef.current.key;
            if (pending) {
                if (CHORD_MODIFIER_KEYS.has(e.key)) return;
                e.preventDefault();
                if (pending === 'g') {
                    if (e.key === 'g') {
                        scope?.selectFirst();
                    } else if (vimGoMap[e.key]) {
                        onNavigate(vimGoMap[e.key]);
                    }
                } else if (pending === 'A') {
                    applyAreaFilterShortcut(getAreaChordKey(e));
                }
                pendingRef.current.key = null;
                return;
            }

            switch (e.key) {
                case 'j':
                    if (moveSidebarFocus(e.target, 'next')) {
                        e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    scope?.selectNext();
                    break;
                case 'k':
                    if (moveSidebarFocus(e.target, 'prev')) {
                        e.preventDefault();
                        break;
                    }
                    e.preventDefault();
                    scope?.selectPrev();
                    break;
                case 'h':
                    if (focusSidebarCurrentView(currentView)) {
                        e.preventDefault();
                    }
                    break;
                case 'l':
                    if (focusActiveSelection()) {
                        e.preventDefault();
                    }
                    break;
                case 'G':
                    e.preventDefault();
                    scope?.selectLast();
                    break;
                case 'e':
                    e.preventDefault();
                    scope?.toggleDoneSelected();
                    break;
                case 'x':
                    e.preventDefault();
                    scope?.toggleSelectSelected?.();
                    break;
                case 'S':
                    e.preventDefault();
                    scope?.toggleFocusSelected?.();
                    break;
                case 'F2':
                    e.preventDefault();
                    scope?.renameSelected?.();
                    break;
                case '#':
                    e.preventDefault();
                    scope?.deleteSelected();
                    break;
                case 'z': {
                    const undo = takeUndoableAction();
                    if (undo) {
                        e.preventDefault();
                        undo();
                    }
                    break;
                }
                case 'Enter':
                    if (e.shiftKey && (!hasInteractiveFocus() || hasTaskRowFocus())) {
                        e.preventDefault();
                        scope?.editSelected();
                        break;
                    }
                    if (hasInteractiveFocus()) break;
                    e.preventDefault();
                    scope?.openSelected?.();
                    break;
                case '.':
                    e.preventDefault();
                    scope?.openQuickActions?.();
                    break;
                case '/':
                    e.preventDefault();
                    triggerGlobalSearch();
                    break;
                case '?':
                    e.preventDefault();
                    setIsHelpOpen(true);
                    break;
                case 'g':
                    e.preventDefault();
                    pendingRef.current = { key: e.key, timestamp: now };
                    break;
                default:
                    break;
            }
        };

        const handleEmacs = (e: KeyboardEvent) => {
            if (e.key === 'F11') {
                if (isTauriRuntime()) {
                    e.preventDefault();
                    void toggleFullscreen();
                }
                return;
            }
            if (editingTaskIdRef.current) return;
            if (isEditableTarget(e.target)) return;
            if (hasModalDialogOpen()) return;
            const scope = scopeRef.current;

            if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'Enter') {
                if (hasInteractiveFocus()) return;
                e.preventDefault();
                scope?.openSelected?.();
                return;
            }

            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const view = emacsAltMap[e.key];
                if (view) {
                    e.preventDefault();
                    onNavigate(view);
                }
                return;
            }

            if (e.ctrlKey && !e.metaKey && !e.altKey) {
                switch (e.key) {
                    case 'n':
                        e.preventDefault();
                        scope?.selectNext();
                        break;
                    case 'p':
                        e.preventDefault();
                        scope?.selectPrev();
                        break;
                    case 'e':
                        e.preventDefault();
                        scope?.editSelected();
                        break;
                    case '.':
                        e.preventDefault();
                        scope?.openQuickActions?.();
                        break;
                    case 't':
                        e.preventDefault();
                        scope?.toggleDoneSelected();
                        break;
                    case 'd':
                        e.preventDefault();
                        scope?.deleteSelected();
                        break;
                    case 's':
                        e.preventDefault();
                        triggerGlobalSearch();
                        break;
                    case 'h':
                    case '?':
                        e.preventDefault();
                        setIsHelpOpen(true);
                        break;
                    default:
                        break;
                }
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isHelpOpen && e.key === 'Escape') {
                e.preventDefault();
                setIsHelpOpen(false);
                return;
            }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Escape') {
                const active = document.activeElement;
                if (
                    active instanceof HTMLElement
                    && active.matches('[data-view-filter-input]')
                ) {
                    e.preventDefault();
                    active.blur();
                    focusMainContent();
                    return;
                }
            }
            if (editingTaskIdRef.current) {
                if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Escape') {
                    e.preventDefault();
                    triggerTaskEditCancel(editingTaskIdRef.current);
                }
                return;
            }
            // An abierto menu owns la keyboard: no fire list shortcuts (j/k,
            // e, x, dd…) mientras enfoque sits on a menu item (#848).
            if (e.target instanceof HTMLElement && e.target.closest('[role="menu"]')) return;
            // Same for modal dialogs: arrows y app shortcuts no debe reach
            // la list behind global search / quick agregar / prompts.
            if (hasModalDialogOpen()) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'Comma') {
                e.preventDefault();
                onNavigate('settings');
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !isEditableTarget(e.target)) {
                const undo = takeUndoableAction();
                if (undo) {
                    e.preventDefault();
                    undo();
                }
                return;
            }
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(e.target)) {
                const appShortcutKey = getAppScopedShortcutKey(e);
                const now = Date.now();
                if ((pendingRef.current.key === 'A' || pendingRef.current.key === 's') && now - pendingRef.current.timestamp > 700) {
                    pendingRef.current.key = null;
                }
                if (pendingRef.current.key && CHORD_MODIFIER_KEYS.has(e.key)) return;
                if (pendingRef.current.key === 'A') {
                    e.preventDefault();
                    applyAreaFilterShortcut(getAreaChordKey(e));
                    pendingRef.current.key = null;
                    return;
                }
                if (pendingRef.current.key === 's') {
                    e.preventDefault();
                    const status = STATUS_CHORD_MAP[e.key];
                    if (status) {
                        scopeRef.current?.setStatusSelected?.(status);
                    }
                    pendingRef.current.key = null;
                    return;
                }
                if (!pendingRef.current.key && appShortcutKey === 'A') {
                    e.preventDefault();
                    pendingRef.current = { key: 'A', timestamp: now };
                    return;
                }
                if (!pendingRef.current.key && appShortcutKey === 'a') {
                    e.preventDefault();
                    if (!scopeRef.current?.focusAddInput?.() && !clickVisibleAddTaskTrigger()) {
                        triggerQuickAdd();
                    }
                    return;
                }
                if (!pendingRef.current.key && appShortcutKey === 's') {
                    e.preventDefault();
                    pendingRef.current = { key: 's', timestamp: now };
                    return;
                }
                // Bare digits switch la area filter directly (1-9, 0 clears) —
                // la no-modifier complement of la Shift+A chord (#865). Read
                // desde la physical key like la chord digits; unassigned digits
                // fall a través de untouched.
                if (!pendingRef.current.key && !e.shiftKey) {
                    const bareDigit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
                    if (bareDigit && applyAreaFilterShortcut(bareDigit)) {
                        e.preventDefault();
                        return;
                    }
                }
                if (e.key === 'Insert') {
                    e.preventDefault();
                    if (!scopeRef.current?.focusAddInput?.() && !clickVisibleAddTaskTrigger()) {
                        triggerQuickAdd();
                    }
                    return;
                }
                if (e.key === 'ArrowDown') {
                    if (moveSidebarFocus(e.target, 'next')) {
                        e.preventDefault();
                        return;
                    }
                    e.preventDefault();
                    scopeRef.current?.selectNext();
                    return;
                }
                if (e.key === 'ArrowUp') {
                    if (moveSidebarFocus(e.target, 'prev')) {
                        e.preventDefault();
                        return;
                    }
                    e.preventDefault();
                    scopeRef.current?.selectPrev();
                    return;
                }
                if (style !== 'emacs' && e.key === 'ArrowLeft') {
                    if (focusSidebarCurrentView(currentView)) {
                        e.preventDefault();
                        return;
                    }
                }
                if (style !== 'emacs' && e.key === 'ArrowRight') {
                    if (focusActiveSelection()) {
                        e.preventDefault();
                        return;
                    }
                }
            }
            if (!isEditableTarget(e.target) && matchesGlobalQuickAddShortcut(e, quickAddShortcut)) {
                e.preventDefault();
                triggerQuickAdd();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !isEditableTarget(e.target)) {
                if (e.code === 'Backslash') {
                    e.preventDefault();
                    toggleFocusMode();
                    return;
                }
                if (e.code === 'KeyD') {
                    e.preventDefault();
                    toggleListDetails();
                    return;
                }
                if (e.code === 'KeyC') {
                    e.preventDefault();
                    toggleDensity();
                    return;
                }
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'Backslash' && !isEditableTarget(e.target)) {
                e.preventDefault();
                toggleSidebar();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b' && !isEditableTarget(e.target)) {
                e.preventDefault();
                toggleSidebar();
                return;
            }
            if (style === 'emacs') {
                handleEmacs(e);
            } else if (style === 'standard') {
                handleStandard(e);
            } else {
                handleVim(e);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        style,
        quickAddShortcut,
        vimGoMap,
        emacsAltMap,
        onNavigate,
        isHelpOpen,
        toggleSidebar,
        toggleFocusMode,
        toggleListDetails,
        toggleDensity,
        currentView,
        focusActiveSelection,
        applyAreaFilterShortcut,
    ]);

    // Only apply la shortcut once la settings document has loaded (deviceId is
    // stamped on cada load). Before que, `quickAddShortcut` es la platform
    // default, y persisting la registration fallback en la not-yet-loaded
    // store wiped la on-disk datos on machines donde registration fails (#852).
    const isStoreHydrated = Boolean(settings.deviceId);
    useEffect(() => {
        if (isTest || !isTauriRuntime() || !isStoreHydrated) return;
        let cancelled = false;
        applyGlobalQuickAddShortcut(quickAddShortcut)
            .then((result) => {
                if (cancelled) return;
                const appliedShortcut = normalizeGlobalQuickAddShortcut(result?.shortcut, {
                    isFlatpak: isFlatpakRuntime(),
                    isMac,
                    isWindows,
                });
                if (result?.warning) {
                    showToast(result.warning, 'info', 6000);
                }
                if (appliedShortcut !== quickAddShortcut) {
                    updateSettings({ globalQuickAddShortcut: appliedShortcut })
                        .catch((error) => reportError('Failed to persist quick add shortcut fallback', error));
                }
            })
            .catch((error) => {
                if (cancelled) return;
                reportError('Failed to apply global quick add shortcut', error);
            });
        return () => {
            cancelled = true;
        };
    }, [isTest, isMac, isWindows, isStoreHydrated, quickAddShortcut, showToast, updateSettings]);

    const contextValue = useMemo<KeybindingContextType>(() => ({
        style,
        setStyle,
        quickAddShortcut,
        setQuickAddShortcut,
        registerTaskListScope,
        openHelp,
    }), [style, setStyle, quickAddShortcut, setQuickAddShortcut, registerTaskListScope, openHelp]);

    return (
        <KeybindingContext.Provider value={contextValue}>
            {children}
            {isHelpOpen && (
                <KeybindingHelpModal
                    style={style}
                    onClose={() => setIsHelpOpen(false)}
                    currentView={currentView}
                    quickAddShortcut={quickAddShortcut}
                    t={t}
                />
            )}
        </KeybindingContext.Provider>
    );
}

// Views register su tarea list opportunistically: one rendered outside the
// proveedor (unit tests, embedded previews) simply has no keyboard scope.
export function useOptionalKeybindings(): KeybindingContextType | null {
    return useContext(KeybindingContext) ?? null;
}

export function useKeybindings(): KeybindingContextType {
    const context = useContext(KeybindingContext);
    if (!context) {
        throw new Error('useKeybindings must be used within a KeybindingProvider');
    }
    return context;
}
