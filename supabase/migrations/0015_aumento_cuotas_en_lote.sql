CREATE OR REPLACE FUNCTION public.aumentar_cuotas_impagas()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  cuotas_actualizadas integer;
BEGIN
  UPDATE public.cuotas
  SET monto = round(monto::numeric * 115 / 100)::double precision
  WHERE estado IN ('Pendiente', 'Vencida');

  GET DIAGNOSTICS cuotas_actualizadas = ROW_COUNT;
  RETURN cuotas_actualizadas;
END;
$$;

REVOKE ALL ON FUNCTION public.aumentar_cuotas_impagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aumentar_cuotas_impagas() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';