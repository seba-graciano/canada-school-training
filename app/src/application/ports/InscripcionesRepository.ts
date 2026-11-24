import type { CursoCatalogo } from '../../domain/inscripciones/celdas.ts'
import type { FilaImportable } from '../../domain/inscripciones/validarPlanilla.ts'

// Mirrors docs/inscripciones-contrato.md (importar_inscripciones).
export type AccionFila = 'CREAR' | 'ACTUALIZAR'
export type ResumenImportacion = {
  alumnosCreados: number
  alumnosActualizados: number
  tutoresCreados: number
  tutoresActualizados: number
}
export type ImportacionPrevia = { fecha: string, usuario: string }
export type ErrorServidor = { fila: number | null, codigo: string, mensaje: string }
export type PayloadImportacion = { nombreArchivo: string, hashArchivo: string, filas: FilaImportable[] }

export type RespuestaImportacion =
  | { code: 'SIMULADO' | 'IMPORTADO', importacionPrevia: ImportacionPrevia | null,
      filas: { fila: number, alumno: AccionFila, tutor: AccionFila }[], resumen: ResumenImportacion }
  | { code: 'FILAS_INVALIDAS', importacionPrevia: ImportacionPrevia | null, errores: ErrorServidor[] }
  | { code: 'SIN_PERMISO' }

/** Rejects with a user-safe message when the server cannot be reached or answers something unexpected. */
export interface InscripcionesRepository {
  cursos(): Promise<CursoCatalogo[]>
  importar(payload: PayloadImportacion, soloSimular: boolean): Promise<RespuestaImportacion>
}
