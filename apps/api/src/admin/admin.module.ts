import { Module } from '@nestjs/common';
import { AdminController, StaffDashboardController } from './admin.controller';
import { ContentAdminService } from './content.admin.service';
import { DashboardService } from './dashboard.service';
import { UsersAdminService } from './users.admin.service';

@Module({ controllers: [AdminController, StaffDashboardController], providers: [UsersAdminService, DashboardService, ContentAdminService] })
export class AdminModule {}
