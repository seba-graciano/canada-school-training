# Inscripciones 2027: lo que falta de la exportación (para Federico)

Reparto acordado: Julián hizo la **importación** (ítems 1, 2, 3 y 5 de la OC-2026-0147) y los cimientos compartidos. Federico hace la **exportación del padrón** (ítem 4). Este documento dice qué ya existe, qué reusar y qué falta, con las reglas del FUN-2026-0147 §9.

## 1. Desde dónde arrancar

| PR | Contenido | Estado |
|---|---|---|
| #21 `feat/inscripciones-db` | Catálogo `public.cursos`, `UNIQUE(dni)` + CHECK, tabla `importaciones` | Pendiente de tu revisión |
| `feat/inscripciones-import` (PR 2) | RPC de importación, dominio, puertos de Excel, adaptadores `exceljs`, pantalla | Se abre cuando se mergee #21 |

Creá tu rama desde `develop` **después de mergear los dos**: necesitás el puerto `EscritorPlanilla` y el lector, que están en el PR 2.

## 2. Qué ya existe y conviene reusar

| Qué | Dónde | Para qué te sirve |
|---|---|---|
| Catálogo de cursos | `public.cursos (nivel, curso, orden)`, migración `20261124120100` | Filtros de nivel y curso: no escribas la lista a mano |
| Lectura del catálogo | `SupabaseInscripcionesRepository.cursos()` | Ya valida la respuesta |
| Columnas de la plantilla | `COLUMNAS` en `app/src/domain/inscripciones/validarPlanilla.ts` | El padrón usa las mismas, más Hermanos, Deuda y Cuotas saldadas |
| Puerto de escritura | `app/src/application/ports/EscritorPlanilla.ts` | Describís el libro (hojas, columnas, filas) sin tocar `exceljs` |
| Formatos | `formato: 'moneda'` (número sumable, R-15) y `formato: 'texto'` (DNI como texto, R-16) | Ya probados en `ExcelJsEscritorPlanilla.test.mjs` |
| Ejemplo de armador | `app/src/application/inscripciones/libros.ts` | Seguí el mismo patrón para `armarPadron` |
| Lector + validación | `ExcelJsLectorPlanilla` + `validarPlanilla` | Para el test de ida y vuelta (R-18) |
| Pantalla | `app/src/presentation/inscripciones/InscripcionesScreen.tsx` | Agregá ahí la sección "Exportar padrón" |
| Armado de dependencias | `app/src/presentation/inscripciones/dependencias.ts` | El único lugar donde se eligen los adaptadores |
| Patrón de RPC segura | `supabase/migrations/20261124120600_inscripciones_rpc_importar.sql` | `SECURITY DEFINER`, `search_path = ''`, rol en la primera línea |
| Deuda y hermanos | `dashboard_alumnos` en `20261020205312_audit_financial_integrity.sql:56-84` | Reusá esas definiciones para no calcular la deuda de otra forma |
| Tests | `supabase/tests/inscripciones-rpc.test.mjs` (PGlite) y `app/tests/inscripciones.test.mjs` (Playwright con backend falso) | Copiá el bootstrap |

La librería es `exceljs` 4.4.0 (`docs/adr/001-libreria-excel.md`). Se carga con `import()` dinámico dentro de los adaptadores, así que no tenés que hacer nada para que no pese en la carga inicial.

## 3. Qué falta

### 3.1 RPC `exportar_padron(p_nivel text default null, p_curso text default null)`

- `SECURITY DEFINER`, `set search_path = ''`, nombres calificados.
- Primera línea: solo `admin` y `secretaria`. Un tutor recibe un error de permisos (R-01: "No alcanza con esconder el botón"). Elegí si devolvés `{ success: false, code: 'SIN_PERMISO' }` como la importación o si hacés `raise` con `42501`. Lo importante es que haya un test.
- Sin filtros: "se exportan todos los alumnos activos" (`activo = true`).
- Validá que `p_nivel` y `p_curso` existan en `public.cursos` y que el curso corresponda al nivel.
- Columnas: las de la plantilla (alumno, nivel, curso, `arancel_base` en centavos, datos del tutor) más hermanos, deuda en centavos y cuotas saldadas.
- `revoke all ... from public, anon; grant execute ... to authenticated`.

### 3.2 Armador `armarPadron(filas)` → `LibroPlanilla`

- Hoja con `COLUMNAS` + `Hermanos`, `Deuda`, `Cuotas saldadas`.
- `DNI alumno` y `DNI tutor` con `formato: 'texto'` (R-16).
- `Arancel mensual` y `Deuda` con `formato: 'moneda'` (R-15), en **pesos**. Convertí centavos a pesos solo al final, para Excel. Para sumar, usá los centavos enteros.
- Nombre del archivo: `padron-{nivel o todos}-{AAAA-MM-DD}.xlsx`.

### 3.3 R-17: textos que empiezan con `=`, `+`, `-` o `@`

El escritor ya guarda todo string como texto (nunca como fórmula), pero el FUN pide explícitamente que esos textos se exporten **precedidos de un apóstrofo**. Ojo con el choque con R-18: si exportás `'=Pepe` y después se reimporta, el apóstrofo queda guardado en el nombre. Por otro lado, la importación nunca deja guardar un nombre que empiece con esos caracteres (E17), así que esos casos solo pueden venir de altas manuales. Decidí con el cliente cómo resolverlo y dejalo escrito.

### 3.4 Pantalla

- Filtros de nivel y curso cargados desde `repositorio.cursos()`. El curso tiene que depender del nivel elegido.
- Botón "Exportar padrón", deshabilitado mientras se genera.
- Solo para admin y secretaría. La entrada del menú ya existe (`AppShell`, `onInscripciones`).

### 3.5 Tests

1. PGlite: permisos (tutor, anónimo), solo activos, filtros, nivel o curso inválidos, montos en centavos, cuotas y pagos sin cambios.
2. Unitario: `armarPadron` (columnas, formatos, nombre del archivo).
3. **Ida y vuelta (R-18):** armar el padrón, escribirlo con `ExcelJsEscritorPlanilla`, leerlo con `ExcelJsLectorPlanilla` y pasarlo por `validarPlanilla`: tiene que dar 0 errores. El lector busca columnas por encabezado, así que las tres columnas extra se ignoran.
4. Playwright: paso 6 del FUN §10 ("los alumnos importados aparecen, los montos se suman en Excel y los DNI se ven completos").

## 4. Pregunta abierta para el cliente (es tuya)

"Deuda" y "Cuotas saldadas" no están definidas en el FUN:
- ¿La deuda incluye recargos por mora?
- "Cuotas saldadas", ¿es una cantidad o un monto?

## 5. Cómo correr los tests

```bash
cd app
npm run test:unit
PGLITE_MODULE=<ruta a @electric-sql/pglite/dist/index.js> npm run test:db
PLAYWRIGHT_MODULE=<ruta a playwright/index.mjs> npm run test:ui
```

La prueba de UI "redesigned screens fit desktop, tablet and mobile with locally resolved assets" ya fallaba en `develop` antes de esta feature (geometría de un SVG en la pantalla de Cuentas). No es tuya ni de la importación.
