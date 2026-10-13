import { Module, Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/csrf';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { RateLimitGuard } from './common/rate-limit';
import { ENV, loadEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { MediaModule } from './media/media.module';
import { PostsModule } from './posts/posts.module';
import { EngagementModule } from './engagement/inbox.module';
import { SiteModule } from './site/site.module';
import { MapModule } from './map/map.module';
import { AdminModule } from './admin/admin.module';
import { ChatModule } from './chat/chat.module';
import { ModerationModule } from './moderation/moderation.module';
import { Global } from '@nestjs/common';

const envProvider: Provider = { provide: ENV, useFactory: () => loadEnv() };

@Global()
@Module({ providers: [envProvider, RateLimitGuard], exports: [envProvider, RateLimitGuard] })
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CacheModule,
    AuditModule,
    OutboxModule,
    AuthModule,
    MediaModule,
    PostsModule,
    EngagementModule,
    SiteModule,
    MapModule,
    AdminModule,
    ChatModule,
    ModerationModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: CsrfGuard }, // every unsafe method needs Origin + double-submit token
  ],
})
export class AppModule {}
