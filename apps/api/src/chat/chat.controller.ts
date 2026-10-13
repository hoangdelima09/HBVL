import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { chatRequestSchema } from '@hbvl/contracts';
import type { z } from 'zod';
import { RateLimit } from '../common/rate-limit';
import { body, ZodBody } from '../common/zod';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller()
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  /** Public site assistant. Every call can cost money upstream, so limits are tight: per IP (and per account when signed in). */
  @Post('chat')
  @HttpCode(200)
  @RateLimit({ name: 'chat', limit: 12, windowSeconds: 60, scope: 'both' }, { name: 'chat-day', limit: 150, windowSeconds: 86_400, scope: 'both' })
  @ZodBody(chatRequestSchema)
  ask(@body(chatRequestSchema) dto: z.infer<typeof chatRequestSchema>) {
    return this.svc.answer(dto);
  }
}
