# Correcciones de la auditoría del 20 de octubre de 2026

Esta entrega corrige el contrato financiero y los fallos de sesión, alumnos e interfaz
del informe original. La copia extraída se sincroniza con el código mantenido; el ZIP
permanece como referencia histórica de entrenamiento. Estado: implementación local
verificada; commits y revisión nativa pendientes de la estrategia de entrega.
Los resultados observados se registran en `odd/tasks/audit-findings.md`.

Triage original: **5 altas** (AUD-01–04 y LEG-01), **19 medias** (AUD-05–13 y
LEG-02–11) y **4 bajas** (AUD-14–17). No hubo hallazgos críticos confirmados.

## Contrato financiero

- Los importes persistidos son centavos enteros. Total = monto + recargo - descuento;
  saldo = total menos pagos válidos, con mínimo cero.
- Sólo se almacenan `Pagada`, `Pendiente` y `Vencida`. Las etiquetas históricas
  conocidas se convierten durante la normalización; no se admiten como variantes
  en escrituras nuevas. `Pagada` protege el historial aun sin comprobantes importados.
  La conversión de etiquetas conserva todos los importes y pagos.
- Hermanos por fecha de alta e ID: primero 0%, segundo 10%, tercero y posteriores 20%.
  Las cuotas nuevas y las impagas sin comprobantes guardan el descuento monetario.
  Un descuento explícito mayor se conserva; el mismo descuento familiar no se duplica.
- Los aumentos omiten cuotas pagadas o con comprobantes, incluidas las de pago parcial.
  Estas últimas conservan los importes sobre los que ya se emitieron recibos.
- `cobrar_cuota(integer)` conserva el acceso anterior del personal y cobra el remanente.
  `cobrar_cuota_confirmada(integer,integer)` exige además que el saldo coincida con los
  centavos revisados. La comprobación y el pago ocurren bajo el mismo bloqueo de cuota.
- `AMOUNT_CHANGED` obliga a consultar/revisar otra vez. `INVALID_AMOUNT` no escribe:
  los NULL, importes negativos o comprobantes inválidos necesitan revisión de datos.
- `aumentar_cuotas_impagas()` delega al aumento autorizado; no mantiene otra regla.
- El segundo vencimiento sigue delimitando la mora. No se inventó una tasa nueva.

## Instalación y compatibilidad

### Normalización de estados en bases nuevas y existentes

El 21 de octubre se confirmó una variante hospedada cuyo `cuotas_estado_check`
acepta únicamente `pagado`, `pendiente` y `vencida`. El nuevo RPC escribe `Pagada`;
la restricción anterior rechaza esa actualización y revierte también el pago.
La simulación previa del historial omitía la restricción y no cubría esta variante.

Aplique el contenido completo de
[support_legacy_installment_states.sql](../supabase/patches/support_legacy_installment_states.sql)
después de la cadena de migraciones, también en instalaciones nuevas. Requiere
que el RPC financiero anterior ya esté instalado. El usuario descartó expresamente
la propuesta de permitir seis etiquetas: el contrato final sólo admite `Pagada`,
`Pendiente` y `Vencida`.

La transacción bloquea la tabla, verifica que no existan estados desconocidos o
NULL, convierte etiquetas históricas conocidas y fija CHECK, NOT NULL y default
`Pendiente`. Actualiza exclusivamente `estado`, sin alterar columnas financieras
ni comprobantes. Ante un valor desconocido o NULL aborta sin cambios. No reproduce
la migración 0014 ni altera el historial de CLI. El seed genera sólo estados
canónicos, y los clasificadores de SQL e interfaz rechazan variantes antiguas.
La generación de una nueva identidad de migración queda pendiente: la CLI local
no está disponible y su descarga fue rechazada por la revisión automática.

Las regresiones cubren el error exacto antes del parche, la conversión de etiquetas,
el cobro sin duplicados, los defaults y el rechazo de escrituras no canónicas.
Comparan todas las columnas salvo el cambio autorizado de estado y todos los pagos.
También verifican que un valor desconocido o NULL revierta toda la transacción.
La prueba de datos de ejemplo usa una base descartable antes de las conversiones
de fechas/importes; nunca ejecuta el seed sobre datos existentes. El generador
heredado conserva su orden y sus sorteos dentro de una transacción; convierte los
estados antes del COMMIT. De este modo los datos confirmados sólo contienen estados
canónicos, sin cambiar los importes ni la asignación de pagos de ejemplo. Este
importador inicial no habilita variantes en escrituras sobre el esquema final.
Las pruebas de la propuesta anterior de seis etiquetas quedan históricas y han
sido sustituidas. La versión estricta pasó 104 pruebas unitarias, 37 SQL y 34 de
navegador, además de TypeScript y build. Lint conserva cuatro advertencias ya
documentadas. Una ejecución SQL con otras comprobaciones concurrentes tuvo un
fallo genérico de proceso; el archivo afectado pasó aislado y la suite SQL completa
pasó después sin comprobaciones superpuestas. La causa de ese fallo no se confirmó.
La revisión independiente comparó el seed contra la versión previa: mismos 500
tutores, 800 alumnos, 5600 cuotas tras convertir etiquetas y 2265 pagos idénticos.
La regresión conserva el generador previo como fixture y compara huellas de todos
los registros salvo timestamps de creación y la conversión autorizada de estados.
También se probaron el esquema canónico, la variante previa de seis estados, la
reaplicación y la reversión completa al rechazar datos desconocidos o NULL.
La aplicación remota sigue pendiente.

### Migración financiera

La corrección está en la migración de avance
`20261020205312_audit_financial_integrity.sql`. No se editaron las migraciones antiguas.
La migración concilia descuentos únicamente en cuotas válidas, impagas y sin pagos;
no borra registros ni modifica comprobantes. El propietario de la base debe revisar
el historial antes de aplicarla una vez, siguiendo [SETUP](../SETUP.md). No se aplicó
ningún cambio a una base remota desde esta entrega.

El alta del personal valida nombre, apellido, DNI, tutor e importe tanto en el formulario
como en un trigger de las escrituras autenticadas. Los registros históricos nulos se
pueden consultar sin derribar el listado; las importaciones del propietario conservan
su autoridad y requieren su propia revisión de calidad.

## Trazabilidad de los 28 hallazgos

| Hallazgo | Corrección / comprobación |
|---|---|
| AUD-01 | Criterio común de saldado, total neto y estado canónico; prueba de descuentos, recargos e historia pagada |
| AUD-02 | Dashboard informa saldo restante; prueba de 3000 abonados sobre 10000 |
| AUD-03 | RPC cobra 7000 restantes una sola vez; rechazo repetido sin cambios |
| AUD-04 | RPC de confirmación valida importe bajo bloqueo; rechazo sin pago tras aumento |
| AUD-05 | Regla 0/10/20% desde tercero; prueba con diez hijos y descuento persistido |
| AUD-06 | RPC rechaza importes/comprobantes inválidos sin escribir |
| AUD-07 | Decoder Base64URL/UTF-8 compartido por login y restauración |
| AUD-08 | Normalización del resultado de alumnos y ordenamiento tolerante a NULL |
| AUD-09 | Identidad/arancel/tutor válidos en UI y escrituras del personal en SQL |
| AUD-10 | Carga de tutores con error y reintento recuperable |
| AUD-11 | Evento sin rol válido limpia identidad y datos anteriores |
| AUD-12 | Realtime actualiza cuotas de la ficha abierta e invalida selecciones obsoletas |
| AUD-13 | Lecturas paginadas completas de alumnos y tutores, incluso con cap menor al lote pedido |
| AUD-14 | Recuperación de consulta limpia su error anterior |
| AUD-15 | Modal conserva foco durante borrado y vuelve inerte el contenido de fondo |
| AUD-16 | Trigger del menú no se considera clic externo a su propio menú |
| AUD-17 | Documento declara idioma español |
| LEG-01 | Copia recibe migración de avance con guard de perfil vivo y revocación PUBLIC/anon |
| LEG-02 | Copia usa filtros derivados y guardas de respuestas obsoletas |
| LEG-03 | Copia conserva sesión y muestra error si falla logout |
| LEG-04 | Copia usa bloqueo de envío del aumento |
| LEG-05 | Copia usa selección y confirmación explícitas de cuotas |
| LEG-06 | Componente suelto delega al cobro transaccional mantenido |
| LEG-07 | Componente suelto usa fallback de contacto/tutor |
| LEG-08 | Componente suelto usa fechas canónicas de la implementación mantenida |
| LEG-09 | Componente suelto usa conversión explícita entre pesos y centavos |
| LEG-10 | Componente suelto usa alta con vínculo familiar y conservación de datos ante fallo |
| LEG-11 | Componente suelto usa agregación SQL y lecturas completas |

La tabla describe las correcciones implementadas y verificadas localmente. No
reemplaza una verificación del despliegue real ni implica que se aplicó la migración
en producción.

## Resultados observados

- Suite integrada: 103 pruebas unitarias, 34 SQL y 34 de navegador aprobadas.
- Copia antigua real: 34 pruebas SQL aprobadas; runner de pruebas accesible y
  sincronización sin divergencias.
- TypeScript y build de Vite aprobados en una copia temporal independiente con
  configuración ficticia. Oxlint termina correctamente con cuatro advertencias:
  variable de test sin usar, exportación de contexto para Fast Refresh,
  dependencias de un efecto de Realtime y actualización de estado en un efecto.
- Verificación independiente del descuento con diez hijos y de la conservación
  de cuotas pagadas, pagos parciales y datos tras rechazar una operación.
- LEG-01: ambas rutas de aumento rechazan anónimos, tutores, tutores con un claim
  administrativo y usuarios sin perfil; administradores y secretaría conservan
  el flujo legítimo. Las llamadas rechazadas no alteran cuotas ni comprobantes.
- Los bloqueos detectados en la revisión (tipado y runner omitido en la copia)
  se corrigieron en un único lote y pasaron la comprobación dirigida posterior.
- `git diff --check` aprobado. No se instalaron dependencias ni se publicaron cambios.

Límites: la concurrencia entre conexiones PostgreSQL independientes se revisó por
fuente y orden de bloqueo, sin ejecutarse en un servidor PostgreSQL real. El gateway
y runtime Deno desplegados tampoco se probaron. No se inspeccionó producción ni se
ejecutaron migraciones remotas. El informe original permanece inmutable.

## Pruebas reproducibles

Desde `app/`, con Node 24:

```sh
npm run test:unit
npm run test:db
npm run test:ui
npm run build
npm run lint
```

`npm test` ejecuta los tres grupos. No instala herramientas ni contacta servicios.
`PGLITE_MODULE` debe apuntar al módulo local de PGlite. `PLAYWRIGHT_MODULE` identifica
una instalación local de Playwright; los tests de navegador usan Chrome instalado y
respuestas simuladas. Ver `node scripts/test.mjs --help` desde la raíz para los grupos.
Los tests de handlers TypeScript se ejecutan con el soporte nativo de Node 24; esto
no equivale a probar el gateway ni el runtime Deno desplegado.

## Copia antigua y archivos sueltos

Desde la raíz del repositorio principal `canada-school-training/` (no desde la copia):

```sh
node scripts/sync-legacy.mjs
node scripts/sync-legacy.mjs --check
```

El primer comando sincroniza las superficies mantenidas de la copia extraída y crea
la delegación del dashboard suelto. El segundo sólo comprueba divergencias y falla
si las encuentra. La sincronización conserva `.env`, dependencias y Git; rechaza
symlinks y diferencias semánticas en SQL histórico antes de iniciar escrituras.
El ZIP antiguo conserva bugs conocidos y no debe utilizarse para desplegar.

La reversión de reglas de base requiere otra migración explícita y revisión de datos;
no se propone borrar pagos ni deshacer automáticamente descuentos de cuotas ya cobradas.
