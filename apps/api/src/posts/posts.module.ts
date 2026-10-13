import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency.service';
import { PostsPublicController } from './posts.public.controller';
import { PostsPublicService } from './posts.public.service';
import { MyPostsController } from './posts.member.controller';
import { AdminPostsController, StaffPostsController } from './posts.staff.controller';
import { PostWorkflowService } from './workflow.service';

@Module({
  controllers: [PostsPublicController, MyPostsController, StaffPostsController, AdminPostsController],
  providers: [PostsPublicService, PostWorkflowService, IdempotencyService],
  exports: [PostsPublicService, PostWorkflowService, IdempotencyService],
})
export class PostsModule {}
