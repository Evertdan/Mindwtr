import { describe, expect, it } from 'vitest';

import { buildTaskUpdatesFromSpeechResult } from './task-speech';

describe('buildTaskUpdatesFromSpeechResult', () => {
    it('maps a smart-parse result into task field updates', () => {
        const plan = buildTaskUpdatesFromSpeechResult(
            {
                title: 'Audio Note Apr 7',
                description: undefined,
                dueDate: undefined,
                startTime: undefined,
                tags: ['#home'],
                contexts: [],
                projectId: undefined,
            },
            {
                transcript: 'Llamada the electrician tomorrow at 3pm',
                title: 'Llamada electrician',
                description: 'Ask about the hallway light.',
                dueDate: '2026-04-08T15:00:00.000Z',
                tags: ['urgent'],
                contexts: ['@phone'],
                projectTitle: 'House',
            },
            {
                ai: {
                    speechToText: {
                        mode: 'smart_parse',
                        fieldStrategy: 'smart',
                    },
                },
            },
        );

        expect(plan).toEqual({
            updates: {
                title: 'Llamada electrician',
                description: 'Ask about the hallway light.',
                dueDate: '2026-04-08T15:00:00.000Z',
                tags: ['#home', '#urgent'],
                contexts: ['@phone'],
            },
            suggestedProjectTitle: 'House',
        });
    });

    it('uses transcript-only field strategy and skips project suggestion when one already exists', () => {
        const plan = buildTaskUpdatesFromSpeechResult(
            {
                title: 'Existing title',
                description: 'Keep me',
                dueDate: undefined,
                startTime: undefined,
                tags: [],
                contexts: ['@work'],
                projectId: 'project-1',
            },
            {
                transcript: 'Draft the launch email and send it by Friday morning',
                projectTitle: 'Ignored',
                contexts: ['desk'],
            },
            {
                ai: {
                    speechToText: {
                        mode: 'transcribe_only',
                        fieldStrategy: 'description_only',
                    },
                },
            },
        );

        expect(plan).toEqual({
            updates: {
                description: 'Draft the launch email and send it by Friday morning',
                contexts: ['@work', '@desk'],
            },
            suggestedProjectTitle: undefined,
        });
    });

    it('ignores bracket-only caption transcripts from local Whisper', () => {
        const plan = buildTaskUpdatesFromSpeechResult(
            {
                title: '',
                description: undefined,
                dueDate: undefined,
                startTime: undefined,
                tags: [],
                contexts: [],
                projectId: undefined,
            },
            {
                transcript: '[Unrecognized speech]',
            },
            {
                ai: {
                    speechToText: {
                        mode: 'transcribe_only',
                        fieldStrategy: 'smart',
                    },
                },
            },
        );

        expect(plan).toEqual({
            updates: {},
            suggestedProjectTitle: undefined,
        });
    });

    it('extracts text from structured local ASR transcript metadata', () => {
        const plan = buildTaskUpdatesFromSpeechResult(
            {
                title: 'Audio Note',
                description: undefined,
                dueDate: undefined,
                startTime: undefined,
                tags: [],
                contexts: [],
                projectId: undefined,
            },
            {
                transcript: JSON.stringify({
                    lang: '',
                    emotion: '',
                    event: '',
                    text: 'Cómo I want to play basketball tomorrow. Money.',
                    timestamps: [0.64, 1.2],
                    durations: [0.24, 0.32],
                    tokens: ['H', 'ow'],
                    words: [],
                }),
            },
            {
                ai: {
                    speechToText: {
                        mode: 'smart_parse',
                        fieldStrategy: 'smart',
                    },
                },
            },
        );

        expect(plan).toEqual({
            updates: {
                title: 'Cómo I want to play basketball tomorrow. Money.',
            },
            suggestedProjectTitle: undefined,
        });
    });

    it('keeps normal transcripts that contain bracketed text', () => {
        const plan = buildTaskUpdatesFromSpeechResult(
            {
                title: '',
                description: undefined,
                dueDate: undefined,
                startTime: undefined,
                tags: [],
                contexts: [],
                projectId: undefined,
            },
            {
                transcript: 'Buy [AAA] batteries',
            },
            {
                ai: {
                    speechToText: {
                        mode: 'transcribe_only',
                        fieldStrategy: 'smart',
                    },
                },
            },
        );

        expect(plan.updates.title).toBe('Buy [AAA] batteries');
    });
});
