select setseed(0.4242);
truncate table pagos, cuotas, alumnos, tutores restart identity cascade;
insert into tutores (nombre, apellido, dni, email, telefono)
select
  (array['Carlos','Maria','Jose','Ana','Luis','Laura','Jorge','Sofia','Diego','Lucia','Pablo','Marta','Andres','Elena','Raul'])[1 + floor(random()*15)::int],
  (array['Perez','Garcia','Rodriguez','Gomez','Fernandez','Lopez','Martinez','Sanchez','Romero','Sosa','Acosta','Diaz','Torres','Ruiz','Ramirez'])[1 + floor(random()*15)::int],
  (20000000 + g)::text,
  case when random() < 0.05 then null else 'tutor' || g || '@mail.com' end,
  '11' || (40000000 + floor(random()*9999999)::int)::text
from generate_series(1, 500) g;
insert into alumnos (nombre, apellido, dni, nivel, curso, tutor_id, arancel_base, activo)
select
  (array['Mateo','Valentina','Benjamin','Martina','Thiago','Emma','Bautista','Catalina','Joaquin','Mia','Lorenzo','Isabella','Lucas','Olivia','Santino'])[1 + floor(random()*15)::int],
  (array['Perez','Garcia','Rodriguez','Gomez','Fernandez','Lopez','Martinez','Sanchez','Romero','Sosa','Acosta','Diaz','Torres','Ruiz','Ramirez'])[1 + floor(random()*15)::int],
  (45000000 + g)::text,
  (array['Inicial','Primario','Secundario'])[1 + floor(random()*3)::int],
  'Curso ' || (1 + floor(random()*6)::int),
  1 + floor(random()*500)::int,
  (array[150000, 187500, 210000])[1 + floor(random()*3)::int]::float,
  true
from generate_series(1, 800) g;
insert into cuotas (alumno_id, concepto, mes, anio, monto, descuento, recargo, estado, fecha_vencimiento)
select a.id, 'MATRICULA', 2, 2026, a.arancel_base, 0, 0,
  (array['pagado','PAGO','Ok','PENDIENTE','pendiente','vencida','Vencida','VENCIDA'])[1 + floor(random()*8)::int],
  (case when random() < 0.5 then '10' else '15' end) || '/02/2026'
from alumnos a;
insert into cuotas (alumno_id, concepto, mes, anio, monto, descuento, recargo, estado, fecha_vencimiento)
select a.id, 'Cuota', m, 2026, a.arancel_base, 0, 0,
  (array['pagado','PAGO','Ok','PENDIENTE','pendiente','vencida','Vencida','VENCIDA'])[1 + floor(random()*8)::int],
  (case when random() < 0.5 then '10' else '15' end) || '/' || lpad(m::text, 2, '0') || '/2026'
from alumnos a, generate_series(3, 8) m;
update cuotas set monto = floor(monto) + 0.30, estado = 'pagado' where id % 50 = 0;
insert into pagos (cuota_id, monto_abonado, medio_pago, fecha_pago)
select c.id, c.monto,
  (array['efectivo','tarjeta','transferencia'])[1 + floor(random()*3)::int],
  c.fecha_vencimiento
from cuotas c
where c.estado in ('pagado', 'PAGO', 'Ok') and c.id % 50 <> 0;
insert into pagos (cuota_id, monto_abonado, medio_pago, fecha_pago)
select c.id, floor(c.monto) + 0.10, 'transferencia', c.fecha_vencimiento from cuotas c where c.id % 50 = 0
union all
select c.id, 0.20, 'transferencia', c.fecha_vencimiento from cuotas c where c.id % 50 = 0;
