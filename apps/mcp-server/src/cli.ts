#!/usr/bin/env node
// The package's only executable entry point (npm "bin", built to dist/cli.js). Kept separate
// from index.ts so importing the package as a library (its npm "main") can never boot a stdio
// server as a side effect - see startMcpServer's own doc history for BUG-14: a
// `bun build --target node --format esm` guard here would compile to a tautology that starts
// the server on import too (verified against Node 22).
import { logError, startMcpServer } from './index.js';

startMcpServer().catch((error) => {
  logError('Failed to start server', error);
  process.exit(1);
});
