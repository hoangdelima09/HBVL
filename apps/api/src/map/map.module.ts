import { Module } from '@nestjs/common';
import { MapController } from './map.controller';
import { MapService } from './map.service';
import { MembersAdminController } from './members.admin.controller';
import { MembersAdminService } from './members.admin.service';

@Module({ controllers: [MapController, MembersAdminController], providers: [MapService, MembersAdminService], exports: [MapService] })
export class MapModule {}
