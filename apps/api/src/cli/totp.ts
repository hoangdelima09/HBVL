import { base32Decode, hotp, totpCounter } from '../auth/totp';

/** Dev helper: prints the current TOTP code for a base32 secret (e.g. the seeded dev admin). `pnpm --filter @hbvl/api totp <secret>` */
const secret = process.argv[2];
if (!secret) {
  console.error('usage: totp <base32-secret>');
  process.exit(1);
}
console.log(hotp(base32Decode(secret), totpCounter(Date.now())));
