#!/usr/bin/env node
// Dev runner: tsc (emits decorator metadata, which Nest DI needs — esbuild/tsx does not) in watch mode + node --watch on the output.
import { spawn } from 'node:child_process';
const entry = process.argv[2] ?? 'dist/main.js';
const tsc = spawn('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' });
let node;
setTimeout(() => {
  node = spawn(process.execPath, ['--watch', '--watch-path=dist', entry], { stdio: 'inherit' });
}, 4000);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    tsc.kill();
    node?.kill();
    process.exit(0);
  });
