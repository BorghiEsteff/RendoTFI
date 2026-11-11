import { Body, Controller, Get, Param, Patch, Req, UseGuards, BadRequestException, Query, ParseUUIDPipe } from '@nestjs/common';
import { DevGuard, type DevRequest } from './dev.guard.js';
import { DevService } from './dev.service.js';

@Controller('dev')
@UseGuards(DevGuard)
export class DevController {
  constructor(private readonly service: DevService) {}
  @Get('me') me(@Req() request: DevRequest) {
    return { id: request.dev.id, role: request.dev.role, email: request.dev.email };
  }
  @Get('resumen') resumen() { return this.service.resumen(); }
  @Get('moderacion') moderacion(
    @Query('estado') estado = 'todas',
    @Query('pagina') pagina = '1',
    @Query('q') busqueda = '',
  ) {
    return this.service.moderacion(estado,pagina,busqueda);
  }
  @Get('moderacion/:id/reportes')
  detalleModeracion(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detalleModeracion(id);
  }
  @Get('pagos') pagos() { return this.service.pagos(); }
  @Get('logs') logs() { return this.service.logs(); }

  @Patch('moderacion/:id')
  revisarUnidad(@Req() request: DevRequest, @Param('id', ParseUUIDPipe) id: string, @Body('accion') accion: string) {
    if (!['revisar','restaurar','suspender'].includes(accion)) throw new BadRequestException('Acción no permitida');
    return this.service.revisarUnidad(id, accion as 'revisar' | 'restaurar' | 'suspender', request.dev.id);
  }

  @Patch('pagos/:id')
  revisarPago(@Req() request: DevRequest, @Param('id') id: string, @Body('decision') decision: string) {
    if (!['aprobar','rechazar'].includes(decision)) throw new BadRequestException('Decisión no permitida');
    return this.service.revisarPago(id, decision as 'aprobar' | 'rechazar', request.dev.id);
  }
}
