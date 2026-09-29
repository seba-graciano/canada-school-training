create table tutores (
  id serial primary key,
  nombre varchar,
  apellido varchar,
  dni varchar,
  email varchar,
  telefono varchar,
  created_at timestamp default now()
);
create table alumnos (
  id serial primary key,
  nombre varchar,
  apellido varchar,
  dni varchar,
  nivel varchar,
  curso varchar,
  tutor_id integer references tutores(id) on delete cascade,
  arancel_base float,
  activo boolean default true,
  created_at timestamp default now()
);
create table cuotas (
  id serial primary key,
  alumno_id integer references alumnos(id) on delete cascade,
  concepto varchar,
  mes integer,
  anio integer,
  monto float,
  descuento float,
  recargo float,
  estado varchar,
  fecha_vencimiento varchar,
  created_at timestamp default now()
);
create table pagos (
  id serial primary key,
  cuota_id integer references cuotas(id) on delete cascade,
  monto_abonado float,
  medio_pago varchar,
  fecha_pago varchar,
  created_at timestamp default now()
);
create or replace function buscar_alumnos(q text)
returns setof alumnos as $$
begin
  return query execute format('select * from alumnos where nombre ilike %L or apellido ilike %L', '%' || q || '%', '%' || q || '%');
end;
$$ language plpgsql;
