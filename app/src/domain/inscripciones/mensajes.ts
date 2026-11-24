// Exact texts of FUN-2026-0147 section 7. Tests compare against these strings verbatim.

export type CodigoArchivo = 'F01' | 'F02' | 'F03' | 'F04' | 'F05'
export type CodigoFila =
  | 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06' | 'E07' | 'E08' | 'E09'
  | 'E10' | 'E11' | 'E12' | 'E13' | 'E14' | 'E15' | 'E16' | 'E17' | 'A01'

export type Mensaje = { codigo: CodigoFila, mensaje: string }

export const mensajesArchivo = {
  F01: () => 'El archivo debe ser un Excel .xlsx.',
  F02: () => 'El archivo supera el máximo de 2 MB o 2.000 filas.',
  F03: () => 'No se encontró la hoja "Inscripciones".',
  F04: (columnas: readonly string[]) => `Faltan columnas obligatorias: ${columnas.join(', ')}.`,
  F05: () => 'El archivo no tiene filas para importar.',
} as const

export const mensajesFila = {
  E01: () => 'Falta el DNI del alumno.',
  E02: (valor: string) => `El DNI del alumno "${valor}" no es válido: debe tener 7 u 8 dígitos.`,
  E03: () => 'Falta el nombre del alumno.',
  E04: () => 'Falta el apellido del alumno.',
  E05: () => 'Falta el nivel.',
  E06: (valor: string) => `El nivel "${valor}" no existe. Valores posibles: Inicial, Primario, Secundario.`,
  E07: () => 'Falta el curso.',
  E08: (valor: string, nivel: string) => `El curso "${valor}" no corresponde al nivel ${nivel}.`,
  E09: (valor: string) => `El arancel "${valor}" no es válido: debe ser un número mayor a cero.`,
  E10: (valor: string) => `El arancel "${valor}" tiene más de dos decimales.`,
  E11: (valor: string, filas: readonly number[]) => `El DNI ${valor} está repetido en las filas ${filas.join(', ')}.`,
  E12: () => 'Falta el DNI del tutor.',
  E13: (valor: string) => `El DNI del tutor "${valor}" no es válido: debe tener 7 u 8 dígitos.`,
  E14: () => 'Falta el nombre o el apellido del tutor.',
  E15: (valor: string, filas: readonly number[]) => `El tutor con DNI ${valor} tiene datos distintos en las filas ${filas.join(', ')}.`,
  E16: (valor: string) => `El email "${valor}" no es válido.`,
  E17: (campo: string) => `El campo ${campo} no puede empezar con =, +, - o @.`,
  A01: () => 'El tutor no tiene email: no va a poder recibir avisos por correo.',
} as const

// FUN section 4: shown when the uploaded file was already imported (R-09).
export const avisoImportacionPrevia = (fecha: string, usuario: string) =>
  `Este archivo ya fue importado el ${fecha} por ${usuario}. Si lo confirmás de nuevo no se va a duplicar nada.`
