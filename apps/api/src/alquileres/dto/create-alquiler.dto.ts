import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateAlquilerDto {
  @IsString()
  @IsNotEmpty()
  unidad_id: string;

  @IsString()
  @IsNotEmpty()
  inquilino_id: string;

  @IsString()
  @IsNotEmpty({ message: 'La modalidad es requerida' })
  @IsIn(['mensual', 'diaria', 'por_hora'], { message: 'La modalidad debe ser mensual, diaria o por_hora' })
  modalidad: 'mensual' | 'diaria' | 'por_hora';

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fecha_inicio?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fecha_fin?: Date;

  @IsString()
  @IsOptional()
  inicio_at?: string;

  @IsString()
  @IsOptional()
  fin_at?: string;

  @IsNumber()
  @Min(0.01, { message: 'El monto total debe ser mayor a 0' })
  @IsNotEmpty({ message: 'El monto total es requerido' })
  monto_total: number;

  @IsString()
  @IsOptional()
  @IsIn(['sin_sena', 'heredar_grupo', 'personalizada'])
  sena_eleccion?: 'sin_sena' | 'heredar_grupo' | 'personalizada';

  @IsString()
  @IsOptional()
  @IsIn(['porcentaje', 'monto_fijo'])
  sena_tipo?: 'porcentaje' | 'monto_fijo';

  @IsNumber()
  @Min(0)
  @IsOptional()
  sena_valor?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto_sena?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto_deposito?: number;

  @IsString()
  @IsOptional()
  @IsIn(['cobrado_total', 'seña_cobrada', 'pendiente'])
  estado_pago?: 'cobrado_total' | 'seña_cobrada' | 'pendiente';

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto_cobrado?: number;

  @IsBoolean()
  @IsOptional()
  deposito_recibido?: boolean;

  @IsObject()
  @IsOptional()
  detalle_precio?: {
    modalidad: 'por_hora' | 'diaria' | 'mensual';
    cantidad: number;
    tarifa_base: number;
    cargos_extra: number;
    descuento: number;
    importe_calculado: number;
    origen: 'automatico' | 'manual';
    dia_vencimiento?: number;
    ajuste_porcentaje?: number;
    ajuste_cada_meses?: number;
  };

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  contrato_url?: string;
}
