import { Global, Module, Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CacheModule } from '../cache/cache.module';
import { ENV, loadEnv } from '../config/env';
import { MediaModule } from '../media/media.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { EmailProcessor } from './email.processor';
import { MaintenanceService } from './maintenance.service';
import { OutboxRelay } from './outbox.relay';

const envProvider: Provider = { provide: ENV, useFactory: () => loadEnv() };
@Global()
@Module({ providers: [envProvider], exports: [envProvider] })
class WorkerConfigModule {}

@Module({
  imports: [WorkerConfigModule, PrismaModule, RedisModule, CacheModule, AuditModule, MediaModule],
  providers: [OutboxRelay, EmailProcessor, MaintenanceService],
})
export class WorkerModule {}
