import { Global, Module } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';

@Global()
@Module({ controllers: [MediaController], providers: [MediaService, StorageService, AvatarService], exports: [MediaService, StorageService, AvatarService] })
export class MediaModule {}
