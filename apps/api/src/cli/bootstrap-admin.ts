import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { createPrismaClient } from '@hbvl/database';
import { normalizeEmail, normalizeUsername, emailSchema, usernameSchema } from '@hbvl/contracts';
import * as argon2 from 'argon2';
import { loadEnv } from '../config/env';

/**
 * Creates the FIRST administrator for an environment (no back door: it only works while no active admin exists, unless --force).
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.org BOOTSTRAP_ADMIN_USERNAME=admin pnpm bootstrap:admin
 * A random password is printed ONCE (or pass BOOTSTRAP_ADMIN_PASSWORD). MFA is NOT pre-enabled: sign in at /dang-nhap-quan-tri,
 * open /tai-khoan to enrol TOTP, then sign in again — /admin refuses sessions without a completed MFA step.
 */
async function main() {
  const env = loadEnv();
  const email = emailSchema.parse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? '');
  const username = usernameSchema.parse(process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin');
  const prisma = createPrismaClient({ connectionString: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, poolMax: 2 });
  try {
    const existing = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } });
    if (existing > 0 && !process.argv.includes('--force')) {
      console.error(`An active administrator already exists (${existing}). Use the admin UI to invite more, or pass --force.`);
      process.exit(2);
    }
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
    if (password.length < 12) throw new Error('Password must be at least 12 characters');
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const u = await prisma.user.create({
      data: {
        username,
        usernameNormalized: normalizeUsername(username),
        email,
        emailNormalized: normalizeEmail(email),
        displayName: 'Quản trị viên',
        passwordHash: hash,
        role: 'ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: {} },
      },
      select: { id: true },
    });
    await prisma.auditLog.create({ data: { actorId: u.id, actorRole: 'ADMIN', action: 'user.bootstrap_admin', resourceType: 'user', resourceId: u.id } });
    console.log(`Administrator created: ${username} <${email}>`);
    if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) console.log(`One-time password (shown once, not stored): ${password}`);
    console.log('Next: sign in at /dang-nhap-quan-tri, enrol MFA in /tai-khoan, then sign in again.');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
