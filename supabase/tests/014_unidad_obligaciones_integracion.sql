-- Integration QA. Ejecutar con gestor/delegado real de QA y base con migración aplicada.
-- SIN COMMIT: se revierte toda creación/actualización al finalizar.
BEGIN;
SET LOCAL lock_timeout = '2000ms';
SET LOCAL statement_timeout = '45000ms';

DO $setup$
DECLARE
  sample record;
  other_manager uuid;
BEGIN
  SELECT u.id AS unit_id, u.gestor_id AS manager_id, d.delegado_id AS delegate_id INTO sample
  FROM public.delegaciones d
  JOIN public.unidades u ON u.gestor_id = d.gestor_id
  WHERE d.estado = 'activa' AND d.permiso = 'gestionar' AND u.deleted_at IS NULL
    AND (
      d.alcance_tipo = 'cuenta'
      OR (d.alcance_tipo = 'grupo' AND d.grupo_id = u.grupo_id)
      OR (d.alcance_tipo = 'unidades' AND EXISTS (
        SELECT 1 FROM public.delegacion_unidades du
        WHERE du.delegacion_id = d.id AND du.unidad_id = u.id
      ))
    )
  LIMIT 1;
  IF sample.unit_id IS NULL THEN
    RAISE EXCEPTION 'QA requires an active managing delegate and a scoped unit';
  END IF;
  SELECT id INTO other_manager FROM public.users
  WHERE rol='gestor' AND deleted_at IS NULL AND id<>sample.manager_id LIMIT 1;
  IF other_manager IS NULL THEN
    RAISE EXCEPTION 'QA requires a second manager to verify tenant isolation';
  END IF;
  PERFORM set_config('rendo_expense_test.unit',sample.unit_id::text,true);
  PERFORM set_config('rendo_expense_test.manager',sample.manager_id::text,true);
  PERFORM set_config('rendo_expense_test.delegate',sample.delegate_id::text,true);
  PERFORM set_config('rendo_expense_test.other',other_manager::text,true);
END $setup$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('rendo_expense_test.manager'), true);

DO $integration$
DECLARE
  unit_id uuid := current_setting('rendo_expense_test.unit')::uuid;
  manager_id uuid := current_setting('rendo_expense_test.manager')::uuid;
  delegate_id uuid := current_setting('rendo_expense_test.delegate')::uuid;
  other_id uuid := current_setting('rendo_expense_test.other')::uuid;
  expense_id uuid;
  payment_id uuid;
  n integer;
  rejected boolean;
BEGIN
  INSERT INTO public.unidad_obligaciones
    (gestor_id,unidad_id,tipo,nombre,frecuencia,periodo_inicio,dia_vencimiento,responsable,monto_estimado,moneda)
  VALUES (manager_id,unit_id,'expensas','QA transient only','mensual',DATE '2026-11-01',10,'propietario',123.45,'ARS')
  RETURNING id INTO expense_id;

  SELECT count(*) INTO n FROM public.log_acciones
  WHERE gestor_id=manager_id AND actor_id=manager_id AND accion='crear_obligacion'
    AND recurso_id=unit_id AND metadata->>'obligacion_id'=expense_id::text;
  IF n<>1 THEN RAISE EXCEPTION 'Owner creation audit missing'; END IF;

  INSERT INTO public.unidad_obligacion_periodos
    (obligacion_id,unidad_id,gestor_id,periodo,estado,monto_pagado)
  VALUES(expense_id,unit_id,manager_id,DATE '2026-11-01','pagado',120.00)
  RETURNING id INTO payment_id;
  SELECT count(*) INTO n FROM public.unidad_obligacion_periodos
  WHERE id=payment_id AND estado='pagado' AND pagado_por=manager_id
    AND pagado_at IS NOT NULL AND vencimiento=DATE '2026-11-10';
  IF n<>1 THEN RAISE EXCEPTION 'Payment actor or due date invalid'; END IF;

  -- Never mutate the schedule after historical payments exist.
  rejected:=false;
  BEGIN
    UPDATE public.unidad_obligaciones SET dia_vencimiento=15 WHERE id=expense_id;
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Schedule mutated despite paid history'; END IF;

  -- Other manager must not read the expense or insert payments in this unit.
  PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
  SELECT count(*) INTO n FROM public.unidad_obligaciones WHERE id=expense_id;
  IF n<>0 THEN RAISE EXCEPTION 'Cross tenant read leaked expense'; END IF;
  rejected:=false;
  BEGIN
    INSERT INTO public.unidad_obligacion_periodos
      (obligacion_id,unidad_id,gestor_id,periodo,estado)
    VALUES(expense_id,unit_id,manager_id,DATE '2026-12-01','pendiente');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross tenant payment allowed'; END IF;

  -- Delegate permitted to manage this unit can create a different month payment.
  PERFORM set_config('request.jwt.claim.sub',delegate_id::text,true);
  SELECT count(*) INTO n FROM public.unidad_obligaciones WHERE id=expense_id;
  IF n<>1 THEN RAISE EXCEPTION 'Delegate cannot read scoped expense'; END IF;
  INSERT INTO public.unidad_obligacion_periodos
    (obligacion_id,unidad_id,gestor_id,periodo,estado,monto_pagado)
  VALUES(expense_id,unit_id,manager_id,DATE '2026-12-01','pagado',125.00);

  -- Reopen period with owner and verify the audit actor of delegate payment.
  PERFORM set_config('request.jwt.claim.sub',manager_id::text,true);
  SELECT count(*) INTO n FROM public.log_acciones
  WHERE actor_id=delegate_id AND actor_rol='delegado' AND accion='pagar_obligacion'
    AND metadata->>'periodo'='2026-12' AND metadata->>'obligacion_id'=expense_id::text;
  IF n<>1 THEN RAISE EXCEPTION 'Delegate payment audit missing'; END IF;

  UPDATE public.unidad_obligacion_periodos
  SET estado='pendiente'
  WHERE obligacion_id=expense_id AND periodo=DATE '2026-11-01';
  SELECT count(*) INTO n FROM public.unidad_obligacion_periodos
  WHERE obligacion_id=expense_id AND periodo=DATE '2026-11-01'
    AND estado='pendiente' AND pagado_por IS NULL AND pagado_at IS NULL AND monto_pagado IS NULL;
  IF n<>1 THEN RAISE EXCEPTION 'Reopened payment retained paid fields'; END IF;

  -- Archived obligations must never accept new payments via raw Data API.
  UPDATE public.unidad_obligaciones SET activo=false WHERE id=expense_id;
  rejected:=false;
  BEGIN
    INSERT INTO public.unidad_obligacion_periodos
      (obligacion_id,unidad_id,gestor_id,periodo,estado)
    VALUES(expense_id,unit_id,manager_id,DATE '2027-01-01','pendiente');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Archived obligation still accepted payments'; END IF;
END $integration$;

RESET ROLE;
SELECT 'EXPENSE_QA_INTEGRATION_PASS' AS result;
ROLLBACK;
