import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@hbvl/database';
import { E } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { decrypt, encrypt, randomToken, sha256Hex } from './crypto';
import { generateSecret, otpauthUri, verifyTotp } from './totp';

const ISSUER = 'Hoc Bong Vuon Len';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Starts enrolment: stores an encrypted pending secret (mfaEnabled stays false until a valid code is presented). */
  async beginEnrollment(userId: string, account: string) {
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: encrypt(secret, this.env.MFA_ENCRYPTION_KEY), mfaEnabled: false } });
    return { secret, otpauthUri: otpauthUri(secret, account, ISSUER) };
  }

  /** Verifies a TOTP code with replay protection (a counter value can be used once per user). */
  async checkTotp(userId: string, secretEnc: string, code: string): Promise<boolean> {
    const secret = decrypt(secretEnc, this.env.MFA_ENCRYPTION_KEY);
    const counter = verifyTotp(secret, code);
    if (counter === null) return false;
    const key = `mfa:used:${userId}:${counter}`;
    const first = await this.redis.client.set(key, '1', 'EX', 120, 'NX');
    return first === 'OK';
  }

  /** Completes enrolment and returns 10 one-time recovery codes (shown once; stored only as hashes). */
  async completeEnrollment(userId: string, code: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaSecretEnc: true, mfaEnabled: true } });
    if (!user?.mfaSecretEnc || user.mfaEnabled) throw E.conflict('Không có yêu cầu đăng ký MFA đang chờ.');
    if (!(await this.checkTotp(userId, user.mfaSecretEnc, code))) throw E.validation([{ path: 'code', message: 'Mã xác thực không đúng.' }], 'Mã xác thực không đúng.');
    const codes = Array.from({ length: 10 }, () => `${randomToken(5).slice(0, 5)}-${randomToken(5).slice(0, 5)}`.toLowerCase());
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256Hex(c) })) }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
    ]);
    return codes;
  }

  /** Accepts either a 6-digit TOTP or a recovery code (consumed atomically, one use). */
  async verifyLogin(userId: string, input: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaSecretEnc: true, mfaEnabled: true } });
    if (!user?.mfaEnabled || !user.mfaSecretEnc) return false;
    const code = input.trim();
    if (/^\d{6}$/.test(code)) return this.checkTotp(userId, user.mfaSecretEnc, code);
    const r = await this.prisma.mfaRecoveryCode.updateMany({ where: { userId, codeHash: sha256Hex(code.toLowerCase()), usedAt: null }, data: { usedAt: new Date() } });
    return r.count === 1;
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null } }),
    ]);
  }
}
