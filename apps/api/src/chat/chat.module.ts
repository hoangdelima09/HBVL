import { Module } from '@nestjs/common';
import { MapModule } from '../map/map.module';
import { PostsModule } from '../posts/posts.module';
import { SiteModule } from '../site/site.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { GeminiClient } from './gemini.client';

@Module({ imports: [PostsModule, SiteModule, MapModule], controllers: [ChatController], providers: [ChatService, GeminiClient] })
export class ChatModule {}
