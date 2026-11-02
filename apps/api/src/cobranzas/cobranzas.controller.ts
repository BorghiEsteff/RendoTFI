import {
  BadRequestException, Body, Controller, Get, Param, Post, Query,
  Request, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthenticatedRequest } from '../auth/supabase-auth.guard.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { CobranzasService } from './cobranzas.service.js';

class RegistrarCobroDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999999)
  importe!: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener formato AAAA-MM-DD' })
  fecha_pago!: string;

  @IsIn(['efectivo', 'transferencia', 'mercadopago', 'otro'])
  medio!: 'efectivo' | 'transferencia' | 'mercadopago' | 'otro';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  referencia?: string;
}

class AnularCobroDto {
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  motivo!: string;
}

@UseGuards(SupabaseAuthGuard)
@Controller('cobranzas')
export class CobranzasController {
  constructor(
    private readonly cobranzas: CobranzasService,
    private readonly authz: AuthorizationService,
  ) {}

  private token(req: AuthenticatedRequest): string {
    return req.headers.authorization!.split(' ')[1];
  }

  @Get()
  async listado(
    @Request() req: AuthenticatedRequest,
    @Query('limit') rawLimit?: string,
    @Query('offset') rawOffset?: string,
    @Query('alquiler_id') alquilerId?: string,
  ) {
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
        !Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException('Paginación inválida');
    }
    if (alquilerId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(alquilerId)) {
      throw new BadRequestException('ID de alquiler inválido');
    }
    return this.cobranzas.findAll(this.token(req), limit, offset, alquilerId);
  }

  @Post('alquileres/:alquilerId/generar')
  async generar(@Param('alquilerId') alquilerId: string, @Request() req: AuthenticatedRequest) {
    if (!(await this.authz.canManageAlquiler(req.user, alquilerId))) {
      throw new ForbiddenException('No tenés permiso para generar cuotas de este alquiler');
    }
    return this.cobranzas.generarPlan(this.token(req), alquilerId);
  }

  @Post('cuotas/:cuotaId/pagos')
  async registrar(
    @Param('cuotaId') cuotaId: string,
    @Body() dto: RegistrarCobroDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const alquilerId = await this.cobranzas.findCuotaParent(this.token(req), cuotaId);
    if (!(await this.authz.canManageAlquiler(req.user, alquilerId))) {
      throw new ForbiddenException('No tenés permiso para registrar cobros');
    }
    return this.cobranzas.registrarPago(this.token(req), cuotaId, dto);
  }

  @Post('pagos/:pagoId/anular')
  async anular(
    @Param('pagoId') pagoId: string,
    @Body() dto: AnularCobroDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const alquilerId = await this.cobranzas.findPagoParent(this.token(req), pagoId);
    if (!(await this.authz.canManageAlquiler(req.user, alquilerId))) {
      throw new ForbiddenException('No tenés permiso para anular cobros');
    }
    return this.cobranzas.anularPago(this.token(req), pagoId, dto.motivo);
  }
}
