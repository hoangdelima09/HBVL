import { createApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main() {
  const env = loadEnv();
  const app = await createApp();
  const server = (await app.listen(env.API_PORT, '0.0.0.0')) as import('node:http').Server;
  // Behind a reverse proxy / the Next.js rewrite the upstream must outlive the proxy's idle keep-alive timeout, otherwise the proxy
  // occasionally reuses a socket the API has just closed (Node's default is 5 s) and the request hangs or resets.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
