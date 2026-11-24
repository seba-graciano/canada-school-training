// InscripcionesRepository adapter on Supabase. Validates every answer before the app trusts it.
import type {
  ErrorServidor, ImportacionPrevia, RegistroImportacion, InscripcionesRepository, PayloadImportacion, RespuestaImportacion, ResumenImportacion,
} from '../../application/ports/InscripcionesRepository.ts'
import type { CursoCatalogo } from '../../domain/inscripciones/celdas.ts'

export const ERROR_CONEXION = 'No se pudo conectar con el servidor. Intente nuevamente.'

type Resultado = PromiseLike<{ data: unknown, error: unknown }>
export type ClienteSupabase = {
  rpc(nombre: string, args: Record<string, unknown>): Resultado
  from(tabla: string): { select(columnas: string): { order(columna: string, opciones?: { ascending: boolean }): Resultado } }
}

const esRegistro = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const esEntero = (v: unknown) => Number.isInteger(v) && Number(v) >= 0
const esAccion = (v: unknown) => v === 'CREAR' || v === 'ACTUALIZAR'

function previa(v: unknown): ImportacionPrevia | null | undefined {
  if (v === null || v === undefined) return null
  return esRegistro(v) && typeof v.fecha === 'string' && typeof v.usuario === 'string' ? { fecha: v.fecha, usuario: v.usuario } : undefined
}

function resumen(v: unknown): ResumenImportacion | undefined {
  if (!esRegistro(v)) return undefined
  const { alumnosCreados, alumnosActualizados, tutoresCreados, tutoresActualizados } = v
  return [alumnosCreados, alumnosActualizados, tutoresCreados, tutoresActualizados].every(esEntero)
    ? { alumnosCreados, alumnosActualizados, tutoresCreados, tutoresActualizados } as ResumenImportacion
    : undefined
}

function respuesta(data: unknown): RespuestaImportacion | undefined {
  if (!esRegistro(data)) return undefined
  if (data.code === 'SIN_PERMISO') return { code: 'SIN_PERMISO' }
  const importacionPrevia = previa(data.importacionPrevia)
  if (importacionPrevia === undefined) return undefined
  if (data.code === 'FILAS_INVALIDAS') {
    const errores = data.errores
    const validos = Array.isArray(errores) && errores.every(e => esRegistro(e)
      && (e.fila === null || esEntero(e.fila)) && typeof e.codigo === 'string' && typeof e.mensaje === 'string')
    return validos ? { code: 'FILAS_INVALIDAS', importacionPrevia, errores: errores as ErrorServidor[] } : undefined
  }
  if (data.code === 'SIMULADO' || data.code === 'IMPORTADO') {
    const filas = data.filas
    const validas = Array.isArray(filas) && filas.every(f => esRegistro(f) && esEntero(f.fila) && esAccion(f.alumno) && esAccion(f.tutor))
    const totales = resumen(data.resumen)
    return validas && totales
      ? { code: data.code, importacionPrevia, filas: filas as { fila: number, alumno: 'CREAR' | 'ACTUALIZAR', tutor: 'CREAR' | 'ACTUALIZAR' }[], resumen: totales }
      : undefined
  }
  return undefined
}

export class SupabaseInscripcionesRepository implements InscripcionesRepository {
  private readonly cliente: ClienteSupabase
  constructor(cliente: ClienteSupabase) { this.cliente = cliente }

  async cursos(): Promise<CursoCatalogo[]> {
    const { data, error } = await this.cliente.from('cursos').select('nivel,curso').order('orden')
    if (error || !Array.isArray(data) || !data.every(c => esRegistro(c) && typeof c.nivel === 'string' && typeof c.curso === 'string')) {
      throw new Error(ERROR_CONEXION)
    }
    return data.map(c => ({ nivel: c.nivel, curso: c.curso }))
  }

  async importar(payload: PayloadImportacion, soloSimular: boolean): Promise<RespuestaImportacion> {
    let resultado: { data: unknown, error: unknown }
    try {
      resultado = await this.cliente.rpc('importar_inscripciones', { p_payload: payload, p_solo_simular: soloSimular })
    } catch {
      throw new Error(ERROR_CONEXION)
    }
    const valida = resultado.error ? undefined : respuesta(resultado.data)
    if (!valida) throw new Error(ERROR_CONEXION)
    return valida
  }

  async historial(): Promise<RegistroImportacion[]> {
    const { data, error } = await this.cliente.from('importaciones')
      .select('id,fecha,usuario_email,nombre_archivo,alumnos_creados,alumnos_actualizados,tutores_creados,tutores_actualizados')
      .order('fecha', { ascending: false })
    const validos = Array.isArray(data) && data.every(r => esRegistro(r) && esEntero(r.id) && typeof r.fecha === 'string'
      && typeof r.usuario_email === 'string' && typeof r.nombre_archivo === 'string'
      && [r.alumnos_creados, r.alumnos_actualizados, r.tutores_creados, r.tutores_actualizados].every(esEntero))
    if (error || !validos) throw new Error(ERROR_CONEXION)
    return (data as Record<string, unknown>[]).map(r => ({ id: r.id as number, fecha: r.fecha as string, usuario: r.usuario_email as string,
      nombreArchivo: r.nombre_archivo as string, alumnosCreados: r.alumnos_creados as number, alumnosActualizados: r.alumnos_actualizados as number,
      tutoresCreados: r.tutores_creados as number, tutoresActualizados: r.tutores_actualizados as number }))
  }
}
