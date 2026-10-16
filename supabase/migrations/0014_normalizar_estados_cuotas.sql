UPDATE public.cuotas
SET estado = CASE
  WHEN lower(btrim(estado)) IN ('pagado', 'pagada', 'pago', 'ok') THEN 'Pagada'
  WHEN lower(btrim(estado)) = 'pendiente' THEN 'Pendiente'
  WHEN lower(btrim(estado)) IN ('vencida', 'vencido') THEN 'Vencida'
  ELSE estado
END;

ALTER TABLE public.cuotas
  ALTER COLUMN estado SET NOT NULL,
  ALTER COLUMN estado SET DEFAULT 'Pendiente',
  ADD CONSTRAINT cuotas_estado_check
    CHECK (estado IN ('Pagada', 'Pendiente', 'Vencida'));