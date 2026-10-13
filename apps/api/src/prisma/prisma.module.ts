import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@hbvl/database';
import { ENV, type Env } from '../config/env';

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      inject: [ENV],
      useFactory: (env: Env) => createPrismaClient({ connectionString: env.DATABASE_URL, poolMax: env.DB_POOL_MAX, log: ['warn', 'error'] }),
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}
  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}
