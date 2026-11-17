-- Run in a LOCAL or isolated QA database after applying
-- 20261117211914_unidad_obligaciones_gastos_20261117.sql. No production mutation.
BEGIN;
SELECT plan(12);

SELECT has_table('public', 'unidad_obligaciones', 'templates table exists');
SELECT has_table('public', 'unidad_obligacion_periodos', 'period ledger exists');
SELECT has_column('public', 'unidad_obligaciones', 'gestor_id', 'owner stored on obligation');
SELECT has_column('public', 'unidad_obligaciones', 'unidad_id', 'unit stored on obligation');
SELECT has_column('public', 'unidad_obligacion_periodos', 'periodo', 'separate periods persisted');
SELECT has_column('public', 'unidad_obligacion_periodos', 'pagado_por', 'payment actor persisted');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.unidad_obligaciones'::regclass),
  'obligations RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.unidad_obligacion_periodos'::regclass),
  'periods RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.unidad_obligaciones', 'SELECT'),
  'anonymous cannot read unit obligations'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.unidad_obligacion_periodos', 'SELECT'),
  'anonymous cannot read payment history'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.unidad_obligaciones', 'DELETE'),
  'authenticated users cannot delete obligations'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.unidad_obligacion_periodos', 'DELETE'),
  'authenticated users cannot delete periods'
);
SELECT * FROM finish();
ROLLBACK;
