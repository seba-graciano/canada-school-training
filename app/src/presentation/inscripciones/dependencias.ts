// Composition root for Inscripciones: the only place that picks concrete adapters.
import type { EscritorPlanilla } from '../../application/ports/EscritorPlanilla.ts'
import type { InscripcionesRepository } from '../../application/ports/InscripcionesRepository.ts'
import type { LectorPlanilla } from '../../application/ports/LectorPlanilla.ts'
import { ExcelJsEscritorPlanilla } from '../../infrastructure/excel/ExcelJsEscritorPlanilla.ts'
import { ExcelJsLectorPlanilla } from '../../infrastructure/excel/ExcelJsLectorPlanilla.ts'
import { SupabaseInscripcionesRepository, type ClienteSupabase } from '../../infrastructure/supabase/SupabaseInscripcionesRepository.ts'
import { supabase } from '../../supabase'

export type DependenciasInscripciones = {
  lector: LectorPlanilla
  escritor: EscritorPlanilla
  repositorio: InscripcionesRepository
}

export function crearDependencias(): DependenciasInscripciones {
  return {
    lector: new ExcelJsLectorPlanilla(),
    escritor: new ExcelJsEscritorPlanilla(),
    repositorio: new SupabaseInscripcionesRepository(supabase as unknown as ClienteSupabase),
  }
}
