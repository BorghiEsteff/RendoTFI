-- Optional, additive rental price breakdown and real guarantee-receipt indicator.
-- Existing rentals retain their amounts, historical intervals and original payment states.
ALTER TABLE public.alquileres
  ADD COLUMN IF NOT EXISTS detalle_precio jsonb,
  ADD COLUMN IF NOT EXISTS deposito_recibido boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.alquileres.detalle_precio IS
  'Contract pricing snapshot, calendar quantity, extras/discount and optional monthly due-day / adjustment terms. Not a payment ledger.';
COMMENT ON COLUMN public.alquileres.deposito_recibido IS
  'Whether the guarantee deposit was actually received, independent of the contractual amount and rent receipts.';
