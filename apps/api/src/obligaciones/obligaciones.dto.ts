import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches,
  Max, MaxLength, Min, IsInt,
} from 'class-validator';

const TIPOS = ['expensas', 'inmobiliario', 'municipal', 'luz', 'agua', 'gas', 'mantenimiento', 'otro'] as const;
const FRECUENCIAS = ['mensual', 'bimestral', 'anual', 'unica'] as const;
const RESPONSABLES = ['propietario', 'inquilino', 'gestor', 'otro'] as const;

export class CrearObligacionDto {
  @IsIn(TIPOS)
  tipo!: typeof TIPOS[number];

  @IsString()
  @MaxLength(100)
  nombre!: string;

  @IsIn(FRECUENCIAS)
  frecuencia!: typeof FRECUENCIAS[number];

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  periodo_inicio!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  dia_vencimiento!: number;

  @IsIn(RESPONSABLES)
  responsable!: typeof RESPONSABLES[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  monto_estimado?: number | null;

  @IsIn(['ARS', 'UYU', 'USD'])
  moneda!: 'ARS' | 'UYU' | 'USD';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string | null;
}

export class ActualizarObligacionDto extends PartialType(CrearObligacionDto) {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class MarcarPeriodoDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  periodo!: string;

  @IsIn(['pagado', 'pendiente'])
  estado!: 'pagado' | 'pendiente';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  monto_pagado?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string | null;
}
