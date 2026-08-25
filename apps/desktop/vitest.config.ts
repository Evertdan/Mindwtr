/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const coverageReporters = process.env.CI
    ? ['text', 'lcovonly', 'json-summary']
    : ['text', 'lcov', 'html', 'json-summary'];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            { find: '@', replacement: path.resolve(__dirname, './src') },
            {
                find: /^@mindwtr\/core$/,
                replacement: path.resolve(__dirname, '../../packages/core/src/index.ts'),
            },
            {
                find: /^@mindwtr\/core\/(.+)$/,
                replacement: path.resolve(__dirname, '../../packages/core/src/$1.ts'),
            },
        ],
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        css: true,
        // Vitest's 5s default acts as an implicit machine-speed benchmark here:
        // these are jsdom render tests doing real work (AgendaView renders 30
        // grouped tasks), and they finish in 0.8-3.5s on an idle machine. CI
        // gives the desktop suite a dedicated job, but `bun run verify` runs
        // five workspaces back to back locally, and under that contention the
        // heaviest specs cross 5s and fail with "Test timed out" rather than an
        // assertion. The budget below keeps every assertion identical while
        // leaving a genuine hang detectable.
        testTimeout: 20_000,
        coverage: {
            provider: 'v8',
            reporter: coverageReporters,
        },
    },
});
