# ADR 001: Excel library for Inscripciones 2027

- Status: accepted (draft by the AI assistant at the developer's request; the team should review and restate it in their own words, as TEC-2026-0147 section 10 asks)
- Date: 2026-11-24
- Feature: OC-2026-0147, import side (odd/tasks/inscripciones-2027.md, T9)

## Context

The import screen reads `.xlsx` files that users upload: untrusted input, the same as a form. It also writes three workbooks: the official template with drop-down lists for Nivel and Curso (R-02), the error report (FUN section 8), and, on Federico's side, the student roll with numbers formatted as currency (R-15) and DNIs stored as text (R-16).

Minimum criteria from TEC section 4: known vulnerabilities, last release date, drop-down support, bundle size, and behavior with the unusual cells of the client file (dates, decimals, text starting with `=`).

## Options (checked on 2026-11-24)

| Option | npm audit (prod) | Last release | Drop-downs | Browser size | Reads the client file |
|---|---|---|---|---|---|
| `xlsx` 0.18.5 (npm) | 1 high: CVE-2023-30533, prototype pollution when **reading** a crafted file | 2022-03 (frozen on npm) | not checked | — | not checked |
| SheetJS from cdn.sheetjs.com | outside npm audit (installed from a URL) | — | not checked | — | not checked |
| `read-excel-file` 9.3.20 + `write-excel-file` 4.1.1 | 0 | 2026-11 / 2026-06 | only through a third-party plugin, `@onparallel/write-excel-file-data-validation` 1.0.2 (first release 2026-06) | ~8 KB of package code | yes |
| `exceljs` 4.4.0 | 2 moderate, both from `uuid@8` (GHSA-w5hq-g745-h8pq) | 2023-10 | native (`dataValidation`) | 948 KB minified, 258 KB gzip (prebuilt `dist/exceljs.min.js`) | yes |

How each library read `inscripciones-2027-ejemplo.xlsx` (probe run outside the repository):

- `exceljs` and `read-excel-file` both read row 27 as a `Date` at UTC midnight (2026-03-01) and the fee of row 9 as the number `185000.555`. Both return row 28's DNIs as numbers and row 25's `=HYPERLINK(...)` as plain text, not a formula. Row 24, which is missing from the sheet XML, comes back as empty cells.

## Decision

Use **`exceljs` 4.4.0**, pinned exactly, for both reading and writing. Load it with a dynamic `import()` only when the Inscripciones screen needs it. It appears only in `app/src/infrastructure/excel/`, behind the `LectorPlanilla` and `EscritorPlanilla` ports.

## Why

- It is the only option that covers every workbook requirement on its own: reading, native drop-downs (R-02), number formats (R-15) and explicit text cells (R-16). The lighter pair needs a plugin, younger than this project, for the drop-downs.
- The advisory is not reachable here. GHSA-w5hq-g745-h8pq affects `uuid` v3, v5 and v6 when a buffer argument is passed. `exceljs` calls only `uuidv4()`, and only when it writes conditional-formatting extensions (`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`), which we never use. The SheetJS CVE was disqualifying because it sits in the **read** path, the one that receives untrusted files.
- The browser build is a prebuilt bundle, so its 194 Node dependencies (streams, archiver, temp files) are not shipped to users.

## Consequences

- About 258 KB gzip more, paid only by admin and secretaria when they open Inscripciones (dynamic import, not the initial bundle).
- `npm audit` will keep listing the two moderate `uuid` findings. Do not "fix" them with `npm audit fix --force`, which would downgrade to `exceljs` 3.4.0. Review again if a new release appears or if conditional formatting is ever used.
- The library has had no release since 2023-10. If it is abandoned, only the two adapters change: the domain and the use cases do not import it.
- Excel dates arrive as `Date` at UTC midnight. The domain formats them with UTC getters (`formatearFecha`).
