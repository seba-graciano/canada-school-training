// Presentational: the confirmed imports (R-14), visible only to administrators (client P2).
import { formatearFechaHora } from '../../application/inscripciones/importacion.ts'
import type { RegistroImportacion } from '../../application/ports/InscripcionesRepository.ts'

type Props = { registros: RegistroImportacion[] | null, error: string, cargando: boolean, onActualizar: () => void }

export default function Historial({ registros, error, cargando, onActualizar }: Props) {
  return <section className="panel inscripciones-historial" aria-labelledby="historial-title">
    <div className="panel-header">
      <h2 id="historial-title">Historial de importaciones</h2>
      <button type="button" className="btn-link" disabled={cargando} onClick={onActualizar}>{cargando ? 'Actualizando...' : 'Actualizar'}</button>
    </div>
    {error && <div role="alert" className="error-message inscripciones-historial-error">{error}</div>}
    {registros && <div className="student-table inscripciones-tabla">
      <table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Archivo</th><th>Alumnos</th><th>Tutores</th></tr></thead>
        <tbody>
          {registros.map(r => <tr key={r.id}>
            <td>{formatearFechaHora(r.fecha)}</td>
            <td>{r.usuario}</td>
            <td>{r.nombreArchivo}</td>
            <td>{r.alumnosCreados} creados<small>{r.alumnosActualizados} actualizados</small></td>
            <td>{r.tutoresCreados} creados<small>{r.tutoresActualizados} actualizados</small></td>
          </tr>)}
          {!registros.length && <tr><td colSpan={5}>Todavía no hay importaciones confirmadas.</td></tr>}
        </tbody>
      </table>
    </div>}
  </section>
}
