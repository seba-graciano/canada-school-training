-- Migration 0009: Convert all monetary columns from float to integer (cents)
-- Prevents floating-point precision issues in financial calculations

-- 1. Convert alumnos.arancel_base
alter table alumnos
  alter column arancel_base type integer
  using round(arancel_base * 100)::integer;

-- 2. Convert cuotas.monto, descuento, recargo
alter table cuotas
  alter column monto type integer
  using round(monto * 100)::integer,
  alter column descuento type integer
  using round(descuento * 100)::integer,
  alter column recargo type integer
  using round(recargo * 100)::integer;

-- 3. Convert pagos.monto_abonado
alter table pagos
  alter column monto_abonado type integer
  using round(monto_abonado * 100)::integer;

-- 4. Add comments for clarity
comment on column alumnos.arancel_base is 'Arancel base en centavos';
comment on column cuotas.monto is 'Monto de la cuota en centavos';
comment on column cuotas.descuento is 'Descuento aplicado en centavos';
comment on column cuotas.recargo is 'Recargo aplicado en centavos';
comment on column pagos.monto_abonado is 'Monto abonado en centavos';