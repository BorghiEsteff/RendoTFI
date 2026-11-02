import { IsArray, IsBoolean, IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class GaranteDto {
  @IsString()
  @IsNotEmpty()
  nombre_completo: string;

  @IsString()
  @IsOptional()
  dni?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

export class CreateInquilinoDto {
  @IsString()
  @IsNotEmpty()
  nombre_completo: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsString()
  @IsNotEmpty({ message: 'El DNI es obligatorio' })
  @Matches(/^\s*(?:\d[\s.-]*){7,9}$/, {
    message: 'Ingresá un DNI válido de 7 a 9 dígitos',
  })
  documento: string;

  @IsArray()
  @IsOptional()
  garantes?: GaranteDto[];

  @IsBoolean()
  @IsOptional()
  consentimiento_ley25326?: boolean;

  @IsDateString()
  @IsOptional()
  consentimiento_fecha?: string;
}

