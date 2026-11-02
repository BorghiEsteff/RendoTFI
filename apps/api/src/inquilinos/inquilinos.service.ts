import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateInquilinoDto } from './dto/create-inquilino.dto.js';
import { UpdateInquilinoDto } from './dto/update-inquilino.dto.js';
import { SupabaseService } from '../supabase/supabase.service.js';

@Injectable()
export class InquilinosService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(createInquilinoDto: CreateInquilinoDto, token: string, workspaceId: string) {
    const client = this.supabaseService.getClient(token);

    // The tenant is initially orphaned (not linked to a rental). Scoped delegates
    // cannot SELECT orphan tenants through can_read_inquilino yet, so INSERT
    // ... RETURNING * would trigger a separate SELECT policy check and fail.
    // Generate the UUID in the API and only acknowledge the insert after it succeeds.
    const normalizedDni = typeof createInquilinoDto.documento === 'string'
      ? createInquilinoDto.documento.replace(/\D/g, '')
      : '';
    if (normalizedDni.length < 7 || normalizedDni.length > 9) {
      throw new BadRequestException('El DNI es obligatorio y debe contener de 7 a 9 dígitos');
    }

    const inquilino = {
      ...createInquilinoDto,
      documento: normalizedDni,
      gestor_id: workspaceId,
      id: randomUUID(),
    };

    const { error } = await client.from('inquilinos').insert([inquilino]);

    if (error) {
      if (error.code === '23505' && /inquilinos_dni_global_unico_idx/i.test(error.message || '')) {
        throw new ConflictException('Ya existe un inquilino registrado con ese DNI');
      }
      throw new UnprocessableEntityException(error.message);
    }

    return inquilino;
  }

  async findAll(token: string, workspaceId: string, limit = 10, offset = 0) {
    const client = this.supabaseService.getClient(token);

    const { data, error, count } = await client
      .from('inquilinos')
      .select('*', { count: 'exact' })
      .eq('gestor_id', workspaceId)
      .is('deleted_at', null)
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: false });

    if (error) {
      throw new UnprocessableEntityException(error.message);
    }

    return {
      data: data || [],
      total: count || 0,
      limit,
      offset,
    };
  }

  async findOne(id: string, token: string) {
    const client = this.supabaseService.getClient(token);
    const { data, error } = await client
      .from('inquilinos')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new NotFoundException('Inquilino no encontrado');
    }
    return data;
  }

  async update(id: string, updateInquilinoDto: UpdateInquilinoDto, token: string) {
    const client = this.supabaseService.getClient(token);

    const { data, error } = await client
      .from('inquilinos')
      .update(updateInquilinoDto.documento !== undefined
        ? { ...updateInquilinoDto, documento: updateInquilinoDto.documento.replace(/\D/g, '') }
        : updateInquilinoDto)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Inquilino no encontrado');
      }
      if (error.code === '23505' && /inquilinos_dni_global_unico_idx/i.test(error.message || '')) {
        throw new ConflictException('Ya existe un inquilino registrado con ese DNI');
      }
      throw new UnprocessableEntityException(error.message);
    }

    return data;
  }

  async remove(id: string, token: string) {
    const client = this.supabaseService.getClient(token);

    const { data, error } = await client
      .from('inquilinos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Inquilino no encontrado');
      }
      throw new UnprocessableEntityException(error.message);
    }

    return { message: 'Inquilino borrado lógicamente' };
  }
}
