import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const buildArgs = (entry: string, outfile: string): string[] => [
  'build', entry,
  '--target', 'node',
  '--format', 'esm',
  '--outfile', outfile,
  '--define', 'process.env.NODE_ENV="production"',
  '--external=better-sqlite3',
  '--external=bun:sqlite',
];

/** Runs a Node script and resolves once it exits, or `false` if it's still alive after timeoutMs. */
const runsToCompletion = (scriptPath: string, args: string[], cwd: string, timeoutMs: number): Promise<boolean> => (
  new Promise((resolvePromise) => {
    // A real (async) child_process.spawn, not spawnSync: spawnSync's synchronous stdio 'pipe'
    // implementation does not keep the child's stdin genuinely open the way an interactive MCP
    // client's stdio transport does, so it can't reproduce BUG-14's hang - only async spawn does.
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    child.on('exit', () => finish(true));
    child.on('error', () => finish(false));
  })
);

// BUG-14: `import.meta.main` compiles under `bun build --target node --format esm` to
// `__require.main == __require.module`, which is `undefined == undefined` -> true on Node even
// when the built file is merely IMPORTED rather than run directly (verified on Node 22). A
// top-level "if main, start the server" guard in the LIBRARY entry (index.ts, the package's
// npm "main") therefore boots a stdio server as an import side effect - resuming stdin and
// pinning the event loop with setInterval - for anyone who imports the package, not just users
// who run it as a CLI. The fix moves the unconditional start into the separate cli.ts entry
// (npm "bin", built to dist/cli.js) and drops the guard from index.ts entirely.
//
// This only reproduces against the actual built bundle (bun's `import.meta.main` -> Node
// compilation quirk, not TS source semantics), so the test builds dist/index.js itself rather
// than importing src/index.ts directly. Passes a temp --db so an import that (pre-fix) DOES
// start the server can never bootstrap or touch a real default-location database.
describe('published library entry has no import-time side effect (BUG-14)', () => {
  test('importing the built dist/index.js does not start a server or hang the process', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'mindwtr-mcp-cli-guard-'));
    try {
      const outfile = join(outDir, 'index.js');
      const build = spawnSync('bun', buildArgs(join(packageRoot, 'src/index.ts'), outfile), {
        cwd: packageRoot,
        timeout: 60_000,
      });
      expect(build.status).toBe(0);

      const importerPath = join(outDir, 'importer.mjs');
      writeFileSync(importerPath, `import ${JSON.stringify(outfile)};\n`);
      const dbPath = join(outDir, 'probe.db');

      const exitedOnItsOwn = await runsToCompletion(importerPath, ['--db', dbPath], outDir, 3000);

      expect(exitedOnItsOwn).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
