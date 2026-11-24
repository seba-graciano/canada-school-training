// Workbook descriptions for the official template (FUN section 5) and the error report (FUN section 8).
// They describe content only; the EscritorPlanilla adapter renders them.
import type { ColumnaHoja, LibroPlanilla, ValorCelda } from '../ports/EscritorPlanilla.ts'
import { formatearFecha, type Celda, type CursoCatalogo } from '../../domain/inscripciones/celdas.ts'
import { COLUMNAS, type Columna, type FilaCruda, type ResultadoPlanilla } from '../../domain/inscripciones/validarPlanilla.ts'

export const NOMBRE_PLANTILLA = 'plantilla-inscripciones-2027.xlsx'
export const nombreReporteErrores = (archivo: string) => `errores-${archivo.replace(/\.xlsx$/i, '')}.xlsx`

const FILAS_CON_LISTAS = 1999

// FUN-2026-0147 section 5, verbatim.
const INSTRUCCIONES: readonly (readonly [Columna, string, string, string])[] = [
  ['DNI alumno', 'Sí', '45111222', '7 u 8 dígitos. Se aceptan puntos y espacios, que se quitan.'],
  ['Nombre alumno', 'Sí', 'Sofía', 'Texto. Se quitan espacios sobrantes.'],
  ['Apellido alumno', 'Sí', 'Gómez', 'Texto. Se quitan espacios sobrantes.'],
  ['Nivel', 'Sí', 'Primario', 'Inicial, Primario o Secundario. No importan mayúsculas ni tildes.'],
  ['Curso', 'Sí', '3º Primaria', 'Tiene que corresponder al nivel (ver tabla de cursos).'],
  ['Arancel mensual', 'Sí', '185000', 'Pesos, mayor a cero, hasta dos decimales.'],
  ['DNI tutor', 'Sí', '23456789', 'Igual que el DNI del alumno. Identifica a la familia.'],
  ['Nombre tutor', 'Sí', 'Carlos', 'Texto.'],
  ['Apellido tutor', 'Sí', 'Gómez', 'Texto.'],
  ['Email tutor', 'No', 'cgomez@gmail.com', 'Si viene, tiene que ser válido. Se guarda en minúsculas.'],
  ['Teléfono tutor', 'No', '+54 9 11 5555-1234', 'Texto libre. Puede empezar con +.'],
]

const niveles = (catalogo: readonly CursoCatalogo[]) => [...new Set(catalogo.map(item => item.nivel))]

function columnaPlanilla(titulo: Columna, catalogo: readonly CursoCatalogo[]): ColumnaHoja {
  if (titulo === 'DNI alumno' || titulo === 'DNI tutor') return { titulo, formato: 'texto' }
  if (titulo === 'Nivel') return { titulo, lista: niveles(catalogo) }
  if (titulo === 'Curso') return { titulo, ancho: 16, lista: catalogo.map(item => item.curso) }
  if (titulo === 'Arancel mensual') return { titulo, formato: 'numero' }
  if (titulo === 'Email tutor') return { titulo, ancho: 26 }
  if (titulo === 'Teléfono tutor') return { titulo, ancho: 20, formato: 'texto' }
  return { titulo }
}

/** The official template: an empty Inscripciones sheet with drop-downs and the instructions. */
export function armarPlantilla(catalogo: readonly CursoCatalogo[]): LibroPlanilla {
  const cursosPorNivel = niveles(catalogo).map(nivel =>
    [nivel, '', '', catalogo.filter(item => item.nivel === nivel).map(item => item.curso).join(', ')] as const)
  return {
    hojas: [
      { nombre: 'Inscripciones', columnas: COLUMNAS.map(c => columnaPlanilla(c, catalogo)), filas: [], filasConListas: FILAS_CON_LISTAS },
      {
        nombre: 'Instrucciones',
        columnas: [{ titulo: 'Columna', ancho: 18 }, { titulo: 'Obligatoria' }, { titulo: 'Ejemplo', ancho: 22 },
          { titulo: 'Regla', ancho: 80, ajustarTexto: true }],
        filas: [
          ...INSTRUCCIONES,
          ['', '', '', ''],
          ['Cada fila es un alumno. Si una familia tiene tres hijos, son tres filas con el mismo tutor.', '', '', ''],
          ['', '', '', ''],
          ['Nivel', '', '', 'Cursos válidos'],
          ...cursosPorNivel,
        ],
      },
    ],
  }
}

const valorReporte = (celda: Celda): ValorCelda => celda instanceof Date ? formatearFecha(celda) : celda ?? null

/** Template columns plus "Fila original" and "Errores" first; only rows with errors. */
export function armarReporteErrores(filas: readonly FilaCruda[], resultado: ResultadoPlanilla): LibroPlanilla {
  const crudas = new Map(filas.map(fila => [fila.fila, fila]))
  const conError = resultado.filas.filter(fila => fila.estado === 'conError')
  return {
    hojas: [{
      nombre: 'Inscripciones',
      columnas: [
        { titulo: 'Fila original' },
        { titulo: 'Errores', ancho: 70, ajustarTexto: true },
        ...COLUMNAS.map(titulo => ({ titulo, formato: titulo.startsWith('DNI') ? 'texto' as const : undefined })),
      ],
      filas: conError.map(fila => [
        fila.fila,
        // FUN section 8: "todos los mensajes de la fila", so warnings travel with the errors.
        [...fila.errores, ...fila.avisos].map(mensaje => mensaje.mensaje).join('\n'),
        ...COLUMNAS.map(columna => valorReporte(crudas.get(fila.fila)?.celdas[columna])),
      ]),
    }],
  }
}
