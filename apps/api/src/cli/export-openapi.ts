import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApi, createApp } from '../bootstrap';
import { loadEnv } from '../config/env';

/** Writes the OpenAPI 3 document without opening a port:  pnpm openapi:export [out.json]  (default docs/openapi.json). Needs the same services as the API (it boots the app). */
async function main() {
  const env = loadEnv();
  const app = await createApp();
  await app.init();
  const doc = buildOpenApi(app, env.SESSION_COOKIE_NAME);
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? 'docs/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
