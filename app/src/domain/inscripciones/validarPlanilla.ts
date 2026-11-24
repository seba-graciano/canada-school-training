// Row-by-row validation of the enrollment sheet (FUN-2026-0147 sections 5-7).
// Pure: no React, no Supabase, no Excel library. The courses catalog comes from the database.
import { normalizarCurso, normalizarDni, normalizarNivel, textoCelda, type Celda, type CursoCatalogo } from './celdas.ts'
import { parsearArancel } from './dinero.ts'
import { mensajesFila, type CodigoFila, type Mensaje } from './mensajes.ts'

export const COLUMNAS = [
  'DNI alumno', 'Nombre alumno', 'Apellido alumno', 'Nivel', 'Curso', 'Arancel mensual',
  'DNI tutor', 'Nombre tutor', 'Apellido tutor', 'Email tutor', 'Teléfono tutor',
] as const
export type Columna = typeof COLUMNAS[number]
export const COLUMNAS_OBLIGATORIAS: readonly Columna[] = COLUMNAS.slice(0, 9)

/** A sheet row as read: its row number (header is row 1) and its cells by column header. */
export type FilaCruda = { fila: number, celdas: Partial<Record<Columna, Celda>> }

/** A valid row in the shape of the importar_inscripciones contract (docs/inscripciones-contrato.md). */
export type FilaImportable = {
  fila: number
  alumno: { dni: string, nombre: string, apellido: string, nivel: string, curso: string, arancelCentavos: number }
  tutor: { dni: string, nombre: string, apellido: string, email: string | null, telefono: string | null }
}

export type EstadoFila = 'valida' | 'validaConAviso' | 'conError' | 'ignorada'
export type ResultadoFila = {
  fila: number
  estado: EstadoFila
  errores: Mensaje[]
  avisos: Mensaje[]
  importable: FilaImportable | null
}
export type ResumenPlanilla = { validas: number, validasConAviso: number, conError: number, ignoradas: number, total: number }
export type ResultadoPlanilla = { filas: ResultadoFila[], resumen: ResumenPlanilla }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMPIEZA_CON_FORMULA = /^[=+\-@]/
const CAMPOS_SIN_FORMULA: readonly Columna[] = ['Nombre alumno', 'Apellido alumno', 'Nombre tutor', 'Apellido tutor']

type Analisis = {
  fila: number
  vacia: boolean
  errores: Mensaje[]
  avisos: Mensaje[]
  dniAlumno: string | null
  tutor: FilaImportable['tutor'] | null
  importable: Omit<FilaImportable, 'fila' | 'tutor'> | null
}

const mensaje = (codigo: CodigoFila, texto: string): Mensaje => ({ codigo, mensaje: texto })

function analizar({ fila, celdas }: FilaCruda, catalogo: readonly CursoCatalogo[]): Analisis {
  const texto = (columna: Columna) => textoCelda(celdas[columna])
  const vacia = COLUMNAS.every(columna => texto(columna) === '')
  const errores: Mensaje[] = []
  const avisos: Mensaje[] = []
  if (vacia) return { fila, vacia, errores, avisos, dniAlumno: null, tutor: null, importable: null }

  const dniAlumno = normalizarDni(celdas['DNI alumno'])
  if (texto('DNI alumno') === '') errores.push(mensaje('E01', mensajesFila.E01()))
  else if (!dniAlumno) errores.push(mensaje('E02', mensajesFila.E02(texto('DNI alumno'))))

  const nombre = texto('Nombre alumno')
  const apellido = texto('Apellido alumno')
  if (!nombre) errores.push(mensaje('E03', mensajesFila.E03()))
  if (!apellido) errores.push(mensaje('E04', mensajesFila.E04()))

  const nivel = normalizarNivel(celdas.Nivel, catalogo)
  if (texto('Nivel') === '') errores.push(mensaje('E05', mensajesFila.E05()))
  else if (!nivel) errores.push(mensaje('E06', mensajesFila.E06(texto('Nivel'))))

  // The course is only checked against a known level (FUN row 16 shows E06 alone).
  const curso = nivel ? normalizarCurso(celdas.Curso, nivel, catalogo) : null
  if (texto('Curso') === '') errores.push(mensaje('E07', mensajesFila.E07()))
  else if (nivel && !curso) errores.push(mensaje('E08', mensajesFila.E08(texto('Curso'), nivel)))

  const arancel = parsearArancel(celdas['Arancel mensual'])
  if (!arancel.ok) errores.push(mensaje(arancel.codigo, mensajesFila[arancel.codigo](arancel.valor)))

  const dniTutor = normalizarDni(celdas['DNI tutor'])
  if (texto('DNI tutor') === '') errores.push(mensaje('E12', mensajesFila.E12()))
  else if (!dniTutor) errores.push(mensaje('E13', mensajesFila.E13(texto('DNI tutor'))))

  const nombreTutor = texto('Nombre tutor')
  const apellidoTutor = texto('Apellido tutor')
  if (!nombreTutor || !apellidoTutor) errores.push(mensaje('E14', mensajesFila.E14()))

  const email = texto('Email tutor').toLowerCase()
  if (email && !EMAIL.test(email)) errores.push(mensaje('E16', mensajesFila.E16(texto('Email tutor'))))
  if (!email) avisos.push(mensaje('A01', mensajesFila.A01()))

  for (const campo of CAMPOS_SIN_FORMULA) {
    if (EMPIEZA_CON_FORMULA.test(texto(campo))) errores.push(mensaje('E17', mensajesFila.E17(campo)))
  }

  const telefono = texto('Teléfono tutor')
  return {
    fila, vacia, errores, avisos, dniAlumno,
    tutor: dniTutor ? { dni: dniTutor, nombre: nombreTutor, apellido: apellidoTutor, email: email || null, telefono: telefono || null } : null,
    importable: dniAlumno && nivel && curso && arancel.ok
      ? { alumno: { dni: dniAlumno, nombre, apellido, nivel, curso, arancelCentavos: arancel.centavos } }
      : null,
  }
}

// Groups row numbers by key, keeping only keys that appear in more than one row.
function agrupar(analisis: readonly Analisis[], clave: (a: Analisis) => string | null) {
  const grupos = new Map<string, Analisis[]>()
  for (const a of analisis) {
    const k = clave(a)
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), a])
  }
  return [...grupos].filter(([, filas]) => filas.length > 1)
}

/** Validates every row; E11 and E15 look at the whole sheet and mark every involved row. */
export function validarPlanilla(filas: readonly FilaCruda[], catalogo: readonly CursoCatalogo[]): ResultadoPlanilla {
  const analisis = filas.map(fila => analizar(fila, catalogo))

  for (const [dni, grupo] of agrupar(analisis, a => a.dniAlumno)) {
    const numeros = grupo.map(a => a.fila)
    for (const a of grupo) a.errores.push(mensaje('E11', mensajesFila.E11(dni, numeros)))
  }
  for (const [dni, grupo] of agrupar(analisis, a => a.tutor?.dni ?? null)) {
    const datos = new Set(grupo.map(a => JSON.stringify([a.tutor?.nombre, a.tutor?.apellido, a.tutor?.email])))
    if (datos.size === 1) continue
    const numeros = grupo.map(a => a.fila)
    for (const a of grupo) a.errores.push(mensaje('E15', mensajesFila.E15(dni, numeros)))
  }

  const resultado = analisis.map((a): ResultadoFila => {
    const errores = [...a.errores].sort((x, y) => x.codigo.localeCompare(y.codigo))
    const estado: EstadoFila = a.vacia ? 'ignorada' : errores.length ? 'conError' : a.avisos.length ? 'validaConAviso' : 'valida'
    const importable = !errores.length && a.importable && a.tutor ? { fila: a.fila, ...a.importable, tutor: a.tutor } : null
    return { fila: a.fila, estado, errores, avisos: a.vacia ? [] : a.avisos, importable }
  })

  const contar = (estado: EstadoFila) => resultado.filter(r => r.estado === estado).length
  return {
    filas: resultado,
    resumen: { validas: contar('valida'), validasConAviso: contar('validaConAviso'), conError: contar('conError'),
      ignoradas: contar('ignorada'), total: resultado.length },
  }
}

/** The rows to send to importar_inscripciones, in sheet order. */
export function filasImportables(resultado: ResultadoPlanilla): FilaImportable[] {
  return resultado.filas.flatMap(r => r.importable ? [r.importable] : [])
}
