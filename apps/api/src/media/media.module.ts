import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';

@Global()
@Module({ controllers: [MediaController], providers: [MediaService, StorageService], exports: [MediaService, StorageService] })
export class MediaModule {}
