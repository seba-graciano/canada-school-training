-- Inscripciones 2027 (OC-2026-0147): finish the guardian DNI rule left NOT VALID in 20261124120200.
-- The 2026-11-24 audit found one guardian with DNI '11111111111', a test account created by hand
-- before the 7-8 digit rule. The team confirmed it is test data and approved an 8-digit replacement.
update public.tutores
  set dni = '11111111'
  where dni = '11111111111'
    and not exists (select 1 from public.tutores where dni = '11111111');

-- Checks every existing guardian. If another environment holds a different invalid DNI,
-- this fails on purpose: review that row instead of weakening the rule.
alter table public.tutores validate constraint tutores_dni_formato;
