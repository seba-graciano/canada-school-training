import type { CodigoArchivo } from '../../domain/inscripciones/mensajes.ts'
import type { FilaCruda } from '../../domain/inscripciones/validarPlanilla.ts'

/** An uploaded file, independent of the browser File API. */
export type ArchivoSubido = { nombre: string, contenido: ArrayBuffer }

export type LecturaPlanilla =
  | { ok: true, filas: FilaCruda[], hash: string }
  | { ok: false, codigo: CodigoArchivo, columnasFaltantes?: string[] }

/**
 * Reads the "Inscripciones" sheet into raw cells (string | number | Date | null).
 * It never decides whether a value is valid: that belongs to the domain.
 * File-level problems (F01-F05) reject the whole file.
 */
export interface LectorPlanilla {
  leer(archivo: ArchivoSubido): Promise<LecturaPlanilla>
}
