import { Module } from '@nestjs/common';
import { ContactController } from '../contact/contact.controller';
import { ContactService } from '../contact/contact.service';
import { FeedbackController } from '../feedback/feedback.controller';
import { FeedbackService } from '../feedback/feedback.service';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';

@Module({
  controllers: [EngagementController, FeedbackController, ContactController],
  providers: [EngagementService, FeedbackService, ContactService],
})
export class EngagementModule {}
