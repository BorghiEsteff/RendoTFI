-- DNI is mandatory and unique throughout Rendo, across managers and
-- delegates. Normalize punctuation for comparison, so "12.345.678" and
-- "12345678" cannot identify different tenant records.
--
-- Reserve identifiers even for soft-deleted tenants; never create a second
-- person with the same document and silently fork their rental history.
ALTER TABLE public.inquilinos
  ALTER COLUMN documento SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inquilinos'::regclass
      AND conname = 'inquilinos_documento_dni_obligatorio'
  ) THEN
    ALTER TABLE public.inquilinos
      ADD CONSTRAINT inquilinos_documento_dni_obligatorio
      CHECK (
        documento IS NOT NULL
        AND length(regexp_replace(documento, '[^0-9]', '', 'g')) BETWEEN 7 AND 9
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS inquilinos_dni_global_unico_idx
ON public.inquilinos (
  (regexp_replace(documento, '[^0-9]', '', 'g'))
);
