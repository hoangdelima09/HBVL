import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id with OWASP-recommended minimum (m=19 MiB, t=2, p=1). Parameters are embedded in the PHC string, so they can be raised later with rehash-on-login. */
const OPTIONS: argon2.HashOptions & { raw?: false } = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  private dummy?: Promise<string>;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Burn the same CPU as a real verification so unknown accounts cannot be told apart by timing. */
  async verifyDummy(plain: string): Promise<void> {
    this.dummy ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummy, plain);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
