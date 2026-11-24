// Use cases: preview an uploaded sheet (read, validate, simulate) and confirm it (all or nothing).
import type { ArchivoSubido, LectorPlanilla } from '../ports/LectorPlanilla.ts'
import type {
  AccionFila, ErrorServidor, InscripcionesRepository, PayloadImportacion, ResumenImportacion,
} from '../ports/InscripcionesRepository.ts'
import { avisoImportacionPrevia, mensajesArchivo, type CodigoArchivo, type CodigoFila } from '../../domain/inscripciones/mensajes.ts'
import {
  filasImportables, resumirFilas, validarPlanilla, type FilaCruda, type ResultadoPlanilla,
} from '../../domain/inscripciones/validarPlanilla.ts'

export const ERROR_SIN_PERMISO = 'No tiene permisos para importar inscripciones.'
export const ERROR_CONFIRMAR_CON_ERRORES = 'Corrija los errores de la planilla y vuelva a subirla antes de confirmar.'
export const ERROR_RECHAZO_SERVIDOR = 'El servidor rechazó la planilla. Vuelva a subirla para ver los errores.'
const ERROR_INESPERADO = 'No se pudo completar la operación. Intente nuevamente.'

export type VistaPrevia = {
  nombreArchivo: string
  crudas: FilaCruda[]
  resultado: ResultadoPlanilla
  /** What a confirmation would do with each valid row, by sheet row number. */
  acciones: Record<number, { alumno: AccionFila, tutor: AccionFila }>
  simulacion: ResumenImportacion | null
  avisoImportacionPrevia: string | null
  payload: PayloadImportacion
  puedeConfirmar: boolean
}

export type EstadoPrevisualizacion =
  | { tipo: 'errorArchivo', codigo: CodigoArchivo, mensaje: string }
  | { tipo: 'vistaPrevia', vista: VistaPrevia }
  | { tipo: 'errorServidor', mensaje: string }

export type EstadoConfirmacion =
  | { tipo: 'importado', resumen: ResumenImportacion }
  | { tipo: 'errorServidor', mensaje: string }

type Dependencias = { lector: LectorPlanilla, repositorio: InscripcionesRepository }

const mensajeDe = (error: unknown) => error instanceof Error && error.message ? error.message : ERROR_INESPERADO

/** dd/mm/yyyy HH:mm in Buenos Aires time, for the R-09 notice. */
export function formatearFechaHora(iso: string): string {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(parte => [parte.type, parte.value]))
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`
}

// Rows the server rejected get its errors; the front and the RPC share codes and texts.
function conErroresDelServidor(resultado: ResultadoPlanilla, errores: readonly ErrorServidor[]): ResultadoPlanilla {
  const filas = resultado.filas.map(fila => {
    const propios = errores.filter(error => error.fila === fila.fila)
      .filter(error => !fila.errores.some(e => e.codigo === error.codigo && e.mensaje === error.mensaje))
    if (!propios.length) return fila
    const errores_ = [...fila.errores, ...propios.map(e => ({ codigo: e.codigo as CodigoFila, mensaje: e.mensaje }))]
      .sort((x, y) => x.codigo.localeCompare(y.codigo))
    return { ...fila, estado: 'conError' as const, errores: errores_, importable: null }
  })
  return { filas, resumen: resumirFilas(filas) }
}

export async function previsualizarImportacion(archivo: ArchivoSubido, { lector, repositorio }: Dependencias): Promise<EstadoPrevisualizacion> {
  try {
    const lectura = await lector.leer(archivo)
    if (!lectura.ok) {
      const mensaje = lectura.codigo === 'F04' ? mensajesArchivo.F04(lectura.columnasFaltantes ?? []) : mensajesArchivo[lectura.codigo]()
      return { tipo: 'errorArchivo', codigo: lectura.codigo, mensaje }
    }

    let resultado = validarPlanilla(lectura.filas, await repositorio.cursos())
    const payload: PayloadImportacion = { nombreArchivo: archivo.nombre, hashArchivo: lectura.hash, filas: filasImportables(resultado) }
    let acciones: VistaPrevia['acciones'] = {}
    let simulacion: ResumenImportacion | null = null
    let previa: string | null = null

    if (payload.filas.length) {
      const respuesta = await repositorio.importar(payload, true)
      if (respuesta.code === 'SIN_PERMISO') return { tipo: 'errorServidor', mensaje: ERROR_SIN_PERMISO }
      if (respuesta.importacionPrevia) {
        previa = avisoImportacionPrevia(formatearFechaHora(respuesta.importacionPrevia.fecha), respuesta.importacionPrevia.usuario)
      }
      if (respuesta.code === 'FILAS_INVALIDAS') {
        const generales = respuesta.errores.filter(error => error.fila === null)
        if (generales.length) return { tipo: 'errorServidor', mensaje: generales.map(e => e.mensaje).join(' ') }
        resultado = conErroresDelServidor(resultado, respuesta.errores)
      } else {
        acciones = Object.fromEntries(respuesta.filas.map(f => [f.fila, { alumno: f.alumno, tutor: f.tutor }]))
        simulacion = respuesta.resumen
      }
    }

    const puedeConfirmar = simulacion !== null && resultado.resumen.conError === 0
    return {
      tipo: 'vistaPrevia',
      vista: { nombreArchivo: archivo.nombre, crudas: lectura.filas, resultado, acciones, simulacion,
        avisoImportacionPrevia: previa, payload, puedeConfirmar },
    }
  } catch (error) {
    return { tipo: 'errorServidor', mensaje: mensajeDe(error) }
  }
}

export async function confirmarImportacion(vista: VistaPrevia, { repositorio }: Pick<Dependencias, 'repositorio'>): Promise<EstadoConfirmacion> {
  // The client decision: nothing is imported while any row has an error.
  if (!vista.puedeConfirmar) return { tipo: 'errorServidor', mensaje: ERROR_CONFIRMAR_CON_ERRORES }
  try {
    const respuesta = await repositorio.importar(vista.payload, false)
    if (respuesta.code === 'IMPORTADO') return { tipo: 'importado', resumen: respuesta.resumen }
    if (respuesta.code === 'SIN_PERMISO') return { tipo: 'errorServidor', mensaje: ERROR_SIN_PERMISO }
    return { tipo: 'errorServidor', mensaje: ERROR_RECHAZO_SERVIDOR }
  } catch (error) {
    return { tipo: 'errorServidor', mensaje: mensajeDe(error) }
  }
}
