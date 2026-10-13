// `output: 'standalone'` needs .next/static and public/ next to server.js (same step the Dockerfile performs).
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const app = resolve(import.meta.dirname, '..');
const target = resolve(app, '.next/standalone/apps/web');
if (!existsSync(target)) throw new Error(`standalone output not found at ${target}`);
cpSync(resolve(app, '.next/static'), resolve(target, '.next/static'), { recursive: true });
if (existsSync(resolve(app, 'public'))) cpSync(resolve(app, 'public'), resolve(target, 'public'), { recursive: true });
console.log('standalone assets prepared');
