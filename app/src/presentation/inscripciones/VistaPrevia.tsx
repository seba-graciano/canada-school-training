// Presentational: renders a preview from props and reports user intent. It calls nothing.
import type { VistaPrevia as Vista } from '../../application/inscripciones/importacion.ts'
import type { EstadoFila, ResultadoFila } from '../../domain/inscripciones/validarPlanilla.ts'
import { textoCelda } from '../../domain/inscripciones/celdas.ts'

const etiquetas: Record<EstadoFila, string> = {
  valida: 'Válida', validaConAviso: 'Válida con aviso', conError: 'Con error', ignorada: 'Ignorada',
}
const acciones = { CREAR: 'Se crea', ACTUALIZAR: 'Se actualiza' } as const

type Props = {
  vista: Vista
  soloErrores: boolean
  confirmando: boolean
  descargandoReporte: boolean
  onSoloErrores: (valor: boolean) => void
  onConfirmar: () => void
  onDescargarReporte: () => void
  onSubirOtra: () => void
}

function Resultado({ fila, vista }: { fila: ResultadoFila, vista: Vista }) {
  if (fila.estado === 'ignorada') return <span>Fila vacía.</span>
  const mensajes = [...fila.errores, ...fila.avisos]
  const accion = vista.acciones[fila.fila]
  return <>
    {mensajes.map(m => <span key={m.codigo + m.mensaje} className="inscripciones-mensaje">{m.codigo}: {m.mensaje}</span>)}
    {accion && <span className="inscripciones-accion">Alumno: {acciones[accion.alumno]} · Tutor: {acciones[accion.tutor]}</span>}
  </>
}

export default function VistaPrevia({ vista, soloErrores, confirmando, descargandoReporte, onSoloErrores, onConfirmar, onDescargarReporte, onSubirOtra }: Props) {
  const { resumen, filas } = vista.resultado
  const visibles = soloErrores ? filas.filter(f => f.estado === 'conError') : filas
  const celdas = new Map(vista.crudas.map(c => [c.fila, c.celdas]))
  const tarjetas: [string, number, string][] = [
    ['Válidas', resumen.validas, 'ok'], ['Válidas con aviso', resumen.validasConAviso, 'aviso'],
    ['Con error', resumen.conError, 'error'], ['Ignoradas', resumen.ignoradas, ''], ['Total', resumen.total, ''],
  ]

  return <section className="panel inscripciones-preview" aria-labelledby="preview-title">
    <div className="panel-header">
      <div><h2 id="preview-title">Vista previa</h2><small>{vista.nombreArchivo}</small></div>
      <button type="button" className="btn-link" disabled={confirmando} onClick={onSubirOtra}>Subir otra planilla</button>
    </div>

    {vista.avisoImportacionPrevia && <div role="status" className="inscripciones-aviso">{vista.avisoImportacionPrevia}</div>}

    <dl className="inscripciones-resumen">
      {tarjetas.map(([titulo, valor, tono]) => <div key={titulo} className={tono ? `inscripciones-tarjeta ${tono}` : 'inscripciones-tarjeta'}>
        <dt>{titulo}</dt><dd>{valor}</dd>
      </div>)}
    </dl>

    {vista.simulacion && <p className="inscripciones-simulacion">
      Al confirmar se crean {vista.simulacion.alumnosCreados} alumnos y {vista.simulacion.tutoresCreados} tutores,
      y se actualizan {vista.simulacion.alumnosActualizados} alumnos y {vista.simulacion.tutoresActualizados} tutores.
    </p>}

    <div className="inscripciones-acciones">
      <label className="inscripciones-filtro">
        <input type="checkbox" checked={soloErrores} onChange={event => onSoloErrores(event.target.checked)} />
        Solo filas con error
      </label>
      <div className="inscripciones-botones">
        {resumen.conError > 0 && <button type="button" className="btn btn-secondary" disabled={descargandoReporte} onClick={onDescargarReporte}>
          {descargandoReporte ? 'Generando reporte...' : 'Descargar reporte de errores'}
        </button>}
        <button type="button" className="btn" disabled={!vista.puedeConfirmar || confirmando} onClick={onConfirmar}>
          {confirmando ? 'Importando...' : 'Confirmar importación'}
        </button>
      </div>
    </div>
    {!vista.puedeConfirmar && resumen.conError > 0 && <p className="inscripciones-nota">
      Hay filas con error. Descargá el reporte, corregí la planilla y volvé a subirla: no se importa nada hasta que no haya errores.
    </p>}

    <div className="student-table inscripciones-tabla">
      <table>
        <thead><tr><th>Fila</th><th>Estado</th><th>Alumno</th><th>Curso</th><th>Tutor</th><th>Resultado</th></tr></thead>
        <tbody>
          {visibles.map(fila => {
            const c = celdas.get(fila.fila) ?? {}
            return <tr key={fila.fila} className={`estado-${fila.estado}`}>
              <td>{fila.fila}</td>
              <td><span className={`badge inscripciones-estado ${fila.estado}`}>{etiquetas[fila.estado]}</span></td>
              <td>{textoCelda(c['Nombre alumno'])} {textoCelda(c['Apellido alumno'])}<small>{textoCelda(c['DNI alumno'])}</small></td>
              <td>{textoCelda(c.Curso)}<small>{textoCelda(c.Nivel)}</small></td>
              <td>{textoCelda(c['Nombre tutor'])} {textoCelda(c['Apellido tutor'])}<small>{textoCelda(c['DNI tutor'])}</small></td>
              <td className="inscripciones-resultado"><Resultado fila={fila} vista={vista} /></td>
            </tr>
          })}
          {!visibles.length && <tr><td colSpan={6}>No hay filas con error.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}
