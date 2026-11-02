import { Module } from '@nestjs/common';
import { CobranzasService } from './cobranzas.service.js';
import { CobranzasController } from './cobranzas.controller.js';

@Module({controllers: [CobranzasController], providers: [CobranzasService]})
export class CobranzasModule {}
