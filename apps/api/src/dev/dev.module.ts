import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { DevController } from './dev.controller.js';
import { DevGuard } from './dev.guard.js';
import { DevService } from './dev.service.js';

@Module({
  imports: [SupabaseModule],
  controllers: [DevController],
  providers: [DevGuard, DevService],
})
export class DevModule {}
