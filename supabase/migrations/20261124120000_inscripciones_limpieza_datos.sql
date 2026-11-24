-- Inscripciones 2027 (OC-2026-0147, TEC 6.2 step 1): data-only cleanup before the new constraints.
-- It normalizes legacy values so the courses FK, UNIQUE(dni) and CHECK(dni) can be added.
-- It never deletes rows: deleting a student cascades to its cuotas and pagos.

-- DNIs are digits only (FUN-2026-0147 section 5: dots and spaces are removed).
update public.alumnos
  set dni = regexp_replace(dni, '[.[:space:]]', '', 'g')
  where dni ~ '[.[:space:]]';

update public.tutores
  set dni = regexp_replace(dni, '[.[:space:]]', '', 'g')
  where dni ~ '[.[:space:]]';

-- Legacy rows store 'Curso N' for every level. The official course depends on the level.
-- Inicial has a single official course, so every legacy Inicial course becomes 'Inicial'.
update public.alumnos
  set curso = case nivel
    when 'Inicial' then 'Inicial'
    when 'Primario' then substring(curso from '[1-6]') || 'º Primaria'
    when 'Secundario' then substring(curso from '[1-6]') || 'º Secundaria'
  end
  where curso ~ '^Curso [1-6]$'
    and nivel in ('Inicial', 'Primario', 'Secundario');
