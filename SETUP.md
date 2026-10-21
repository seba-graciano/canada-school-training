# Puesta en marcha local

Use Node 24 y una base Supabase propia o expresamente autorizada. Los pasos de
base de datos distinguen una instalación nueva de una actualización existente:
aplicar nuevamente el esquema o el seed sobre datos existentes puede destruirlos.

## 1. Frontend

Desde la raíz del repositorio:

```sh
cd app
npm ci
```

Copie `app/env.example` a `app/.env.local` y complete `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` con la URL y la clave pública del proyecto elegido.
El nombre de la segunda variable también se utiliza si la clave es publishable.
Nunca coloque una clave `service_role` o secreta en una variable `VITE_`.
Reinicie Vite después de modificar el entorno. Una `.env.local` existente tiene
precedencia sobre `.env`; compruebe que apunta al proyecto esperado.

## 2. Base nueva y descartable

Los archivos de `supabase/migrations/`, ordenados por nombre, son la fuente del
esquema local. Deben aplicarse todos, no solamente `0001_schema.sql`.

1. Aplique `0001_schema.sql` en el SQL Editor del proyecto nuevo.
2. Opcionalmente, aplique `supabase/seed.sql` **en este momento**, antes de las
   migraciones restantes. Es un seed heredado: trunca tablas, usa pesos, fechas
   de texto; sus estados ya usan `Pagada`, `Pendiente` y `Vencida`. No sirve como seed posterior
   al esquema final ni para una base con datos que deban conservarse.
3. Aplique los archivos restantes en orden de nombre. La secuencia y las
   verificaciones están en [la guía de migraciones](docs/tutor-accounts.md#migration-order-and-identities).
4. Aplique el contenido completo de
   [support_legacy_installment_states.sql](supabase/patches/support_legacy_installment_states.sql)
   para fijar el contrato canónico de estados y su clasificador SQL. El archivo
   contiene su propia transacción; no modifica importes ni pagos.

Las migraciones posteriores convierten fechas e importes a sus tipos definitivos
y normalizan los estados. No ejecute `supabase db reset` con este seed esperando
que se aplique después de todas las migraciones: ese orden no es compatible con
el archivo heredado actual.

## 3. Primer administrador y autenticación

Las migraciones crean `perfiles`, pero el seed no crea usuarios Auth ni el primer
administrador. En el proyecto autorizado, cree el primer usuario mediante la
administración de Supabase Auth y copie su UUID. Luego, desde el SQL Editor con
permisos administrativos, cree su perfil:

```sql
insert into public.perfiles (id, user_role, tutor_id)
values ('<UUID del usuario Auth>'::uuid, 'admin', null);
```

Si el perfil ya existe, verifique su rol antes de modificarlo; no vuelva a ejecutar
el alta. En la configuración de Auth Hooks, habilite el Custom Access Token Hook
`public.custom_access_token_hook`. La función está versionada en SQL, pero la
activación del hook en el proyecto no está versionada mediante `config.toml`.
Cierre e inicie sesión después de configurarlo y compruebe el rol recibido.

Para crear otras cuentas desde la aplicación, siga el despliegue de
`create-account` en [la guía de cuentas](docs/tutor-accounts.md). Hasta desplegar
esa función y verificar el hook, no se considera validado el circuito de alta.

La aplicación escucha cambios de `public.pagos`. Si se desea Realtime, verifique
que esa tabla esté incluida en la publicación `supabase_realtime`; el repositorio
no contiene una migración que la agregue. La consulta siguiente permite verificarlo:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pagos';
```

## 4. Ejecutar y comprobar

Desde `app/`:

```sh
npm run dev
npm run build
npm run lint
```

Vite muestra la URL efectiva; normalmente es `http://localhost:5173`. Las pruebas
de cuentas, SQL y regresiones de interfaz se describen en
[la guía de cuentas](docs/tutor-accounts.md#local-checks) y
[las correcciones de auditoría](docs/audit-findings.md#pruebas-reproducibles).

La migración `20261020205312_audit_financial_integrity.sql` corrige saldos, cobros
y descuentos por orden de alta: 0% al primer hijo, 10% al segundo y 20% desde el
tercero. Debe estar aplicada antes de usar el nuevo cobro confirmado desde la UI.
Conserva cuotas pagadas y comprobantes; no aumenta cuotas con pagos parciales.

El único contrato de estados es `Pagada`, `Pendiente` y `Vencida`. En bases
existentes, el parche transaccional
[support_legacy_installment_states.sql](supabase/patches/support_legacy_installment_states.sql)
convierte etiquetas históricas conocidas, fija el default `Pendiente` y rechaza
variantes, estados desconocidos y NULL en escrituras nuevas. Sólo cambia `estado`;
conserva importes y comprobantes. Si encuentra un estado existente desconocido o
NULL, aborta sin cambios para que se revise explícitamente. Sustituye la propuesta
anterior que admitía seis etiquetas. Es un parche SQL manual; no registra ni
repara automáticamente el historial de migraciones.

Un build local correcto no demuestra que el hook, las migraciones o las Edge
Functions estén desplegados. Para bases existentes, use la verificación del
historial de la guía de migraciones antes de aplicar cambios. El antiguo aumento
de `--max-http-header-size` era un workaround; no es un requisito de arranque
comprobado ni sustituye el diagnóstico de un eventual HTTP 431.
