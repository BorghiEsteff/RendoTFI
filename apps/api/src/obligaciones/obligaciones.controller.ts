import {
  Body, Controller, Get, Param, Patch, Post, Query, Request,
  UseGuards, BadRequestException,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/supabase-auth.guard.js';
import { ObligacionesService } from './obligaciones.service.js';
import { ActualizarObligacionDto, CrearObligacionDto, MarcarPeriodoDto } from './obligaciones.dto.js';

function token(req: AuthenticatedRequest): string {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) throw new BadRequestException('Token de sesión no disponible');
  return match[1];
}

@Controller('unidades/obligaciones')
@UseGuards(SupabaseAuthGuard)
export class ObligacionesResumenController {
  constructor(private readonly service: ObligacionesService) {}

  @Get('resumen')
  resumen(
    @Request() req: AuthenticatedRequest,
    @Query('ids') ids?: string,
    @Query('periodo') periodo?: string,
  ) {
    const parsed = ids ? ids.split(',').map(id => id.trim()).filter(Boolean) : [];
    if (parsed.some(id => !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))) {
      throw new BadRequestException('IDs inválidos');
    }
    return this.service.resumen(req.user, token(req), parsed, periodo);
  }
}

@Controller('unidades/:unidadId/obligaciones')
@UseGuards(SupabaseAuthGuard)
export class ObligacionesController {
  constructor(private readonly service: ObligacionesService) {}

  @Get()
  listar(
    @Param('unidadId') unidadId: string,
    @Query('periodo') periodo: string | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.listar(req.user, token(req), unidadId, periodo);
  }

  @Post()
  crear(
    @Param('unidadId') unidadId: string,
    @Body() dto: CrearObligacionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.crear(req.user, token(req), unidadId, dto);
  }

  @Patch(':obligacionId')
  editar(
    @Param('unidadId') unidadId: string,
    @Param('obligacionId') obligacionId: string,
    @Body() dto: ActualizarObligacionDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.editar(req.user, token(req), unidadId, obligacionId, dto);
  }

  @Post(':obligacionId/periodos')
  marcar(
    @Param('unidadId') unidadId: string,
    @Param('obligacionId') obligacionId: string,
    @Body() dto: MarcarPeriodoDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.service.marcar(req.user, token(req), unidadId, obligacionId, dto);
  }
}
