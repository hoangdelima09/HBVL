import { Module } from '@nestjs/common';
import { CommentReportController, StaffModerationController } from './moderation.controller';
import { ReportsService } from './reports.service';
import { UserModerationService } from './user-moderation.service';

@Module({
  controllers: [CommentReportController, StaffModerationController],
  providers: [ReportsService, UserModerationService],
  exports: [ReportsService, UserModerationService],
})
export class ModerationModule {}
