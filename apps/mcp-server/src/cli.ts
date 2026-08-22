#!/usr/bin/env node
// The package's only executable entry point (npm "bin"). Kept separate from index.ts so
// importing the package as a library (its npm "main") can never boot a stdio server as a
// side effect - see startMcpServer's own doc history for BUG-14: a
// `bun build --target node --format esm` guard here would compile to a tautology that starts
// the server on import too (verified against Node 22).
//
// The build copies this file to dist/cli.js verbatim rather than bundling it (see
// package.json's "build" script): bundling re-inlined the whole ~6.4MB index.js graph into
// cli.js too, doubling the published package for no reason since dist/cli.js only needs to
// import dist/index.js at runtime. A verbatim copy works because this file is deliberately
// kept to plain-JS syntax (no TS-only constructs) - `tsc --noEmit` in the typecheck script
// still catches any drift from that.
import { logError, startMcpServer } from './index.js';

startMcpServer().catch((error) => {
  logError('Failed to start server', error);
  process.exit(1);
});
