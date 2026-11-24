# Inscripciones 2027: import contract (front ↔ RPC)

Contract between the import screen and `public.importar_inscripciones`. Follows TEC-2026-0147 section 5 and FUN-2026-0147. Rule codes (R-xx, E-xx, F-xx) are those of the FUN.

## Call

```
importar_inscripciones(p_payload jsonb, p_solo_simular boolean default true) returns jsonb
```

- One RPC for both steps. The preview calls it with `p_solo_simular = true` and the confirmation with `false`. The code that decides what is created or updated is the same in both modes. The simulation does everything and then undoes it.
- Callable by `authenticated`. Only `admin` and `secretaria` get past the first check (R-01).

## Input

The front sends only the rows its own validation accepted: valid rows and valid rows with a warning. Ignored (empty) rows and rows with errors are never sent. Values are already normalized: DNI digits only, trimmed text, official level and course, email in lowercase, money in integer cents.

```json
{
  "nombreArchivo": "inscripciones-2027.xlsx",
  "hashArchivo": "9f2c…e1",
  "filas": [
    {
      "fila": 2,
      "alumno": { "dni": "45111222", "nombre": "Sofía", "apellido": "Gómez",
                  "nivel": "Primario", "curso": "3º Primaria",
                  "arancelCentavos": 18500000 },
      "tutor":  { "dni": "23456789", "nombre": "Carlos", "apellido": "Gómez",
                  "email": "cgomez@gmail.com", "telefono": "+54 9 11 5555-1234" }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `nombreArchivo` | 1–255 characters. |
| `hashArchivo` | SHA-256 of the file bytes, 64 lowercase hex characters. The front computes it with `crypto.subtle.digest`. |
| `filas` | 1–2.000 items in sheet order (R-10, R-12). `fila` is the sheet row number (header is row 1) and is unique. |
| `arancelCentavos` | JSON integer greater than zero. Never a decimal number of pesos. |
| `tutor.email`, `tutor.telefono` | Optional: `null` or omitted when the cell is empty. |

## Output

Same `{ success, code }` style as `cobrar_cuota_confirmada`.

```json
{
  "success": true,
  "code": "SIMULADO",
  "importacionPrevia": { "fecha": "2026-11-24T15:04:05Z", "usuario": "secretaria@canadaschool.edu.ar" },
  "filas": [ { "fila": 2, "alumno": "CREAR", "tutor": "ACTUALIZAR" } ],
  "errores": [],
  "resumen": { "alumnosCreados": 1, "alumnosActualizados": 0,
               "tutoresCreados": 0, "tutoresActualizados": 1 }
}
```

| `code` | `success` | When | Database |
|---|---|---|---|
| `SIN_PERMISO` | false | Caller is not admin or secretaria. Only `success` and `code` are returned. | Unchanged |
| `FILAS_INVALIDAS` | false | Any row fails validation. `errores` lists every error of every row; `filas` is empty and every counter is 0. | Unchanged |
| `SIMULADO` | true | `p_solo_simular = true` and every row is valid. `filas` and `resumen` describe what a confirmation would do. | Unchanged |
| `IMPORTADO` | true | `p_solo_simular = false` and every row is valid. `filas` and `resumen` describe what was done; one row is added to `importaciones` (R-14). | All rows saved |

- `importacionPrevia`: the latest confirmed import with the same `hashArchivo`, or `null`. The screen turns it into the R-09 notice: "Este archivo ya fue importado el {fecha} por {usuario}. Si lo confirmás de nuevo no se va a duplicar nada." `usuario` is the importer's email (open question: name or email).
- `filas[].alumno` / `filas[].tutor`: `CREAR` when the DNI does not exist yet, `ACTUALIZAR` when it does. A guardian repeated in several rows (siblings) is counted once in `resumen` and shows the same action on each of its rows.
- `errores[]`: `{ "fila": 9, "codigo": "E09", "mensaje": "El arancel \"0\" no es válido: debe ser un número mayor a cero." }`, with the exact FUN texts. Payload-level errors use `fila: null` (`F02` more than 2.000 rows, `F05` no rows).

## Server-side validation

The RPC trusts nothing from the payload and validates again with the same codes and messages as the front: E01–E09, E11–E17. `{valor}` is the normalized value it received. E10 (more than two decimals) appears only if `arancelCentavos` is not an integer.

## Writes

1. Serialized with `pg_advisory_xact_lock`: two confirmations never interleave.
2. Guardians first, in order of first appearance, then students in sheet order. Both are `INSERT … ON CONFLICT (dni) DO UPDATE` (R-05, R-06, R-10).
3. Updated guardian: name, surname, email and phone are replaced. A blank email or phone in the sheet keeps the stored value, the same rule as account linking.
4. Updated student: name, surname, level, course, fee and guardian are replaced. `activo` is not changed (open question: reactivate?). New students are created with `activo = true`.
5. `cuotas` and `pagos` are never touched (FUN section 2).
6. Any failure rolls back everything (R-08).
