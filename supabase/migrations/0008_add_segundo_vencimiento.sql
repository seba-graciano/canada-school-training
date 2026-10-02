-- Migration 0008: Add segundo vencimiento and migrate fecha_vencimiento to date
-- Adds grace period support for mora calculation

-- 1. Add second due date column (nullable for backward compatibility)
alter table cuotas add column if not exists fecha_vencimiento_2 date;

-- 2. Migrate fecha_vencimiento from varchar to date
-- Format in data: 'DD/MM/YYYY' or 'D/MM/YYYY'
alter table cuotas
  alter column fecha_vencimiento type date
  using to_date(fecha_vencimiento, 'DD/MM/YYYY');

-- 3. Populate fecha_vencimiento_2 with a default grace period (e.g., 10 days after first vencimiento)
-- Only for rows where it's null
update cuotas
set fecha_vencimiento_2 = fecha_vencimiento + interval '10 days'
where fecha_vencimiento_2 is null;