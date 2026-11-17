import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ObligacionesController, ObligacionesResumenController } from './obligaciones.controller.js';
import { ObligacionesService } from './obligaciones.service.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [ObligacionesResumenController, ObligacionesController],
  providers: [ObligacionesService],
})
export class ObligacionesModule {}
