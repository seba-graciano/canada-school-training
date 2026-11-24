// Container: owns the screen state and runs the use cases. Rendering lives in VistaPrevia.
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { confirmarImportacion, previsualizarImportacion, type VistaPrevia as Vista } from '../../application/inscripciones/importacion.ts'
import { armarPlantilla, armarReporteErrores, NOMBRE_PLANTILLA, nombreReporteErrores } from '../../application/inscripciones/libros.ts'
import type { ResumenImportacion } from '../../application/ports/InscripcionesRepository.ts'
import type { CodigoArchivo } from '../../domain/inscripciones/mensajes.ts'
import AppShell from '../../ui/AppShell'
import DesignIcon from '../../ui/DesignIcon'
import { crearDependencias, type DependenciasInscripciones } from './dependencias.ts'
import VistaPrevia from './VistaPrevia'
import './inscripciones.css'

// Explicit states instead of loose booleans: impossible combinations cannot be represented.
type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'leyendo' }
  | { tipo: 'errorArchivo', codigo: CodigoArchivo, mensaje: string }
  | { tipo: 'vistaPrevia', vista: Vista }
  | { tipo: 'confirmando', vista: Vista }
  | { tipo: 'importado', resumen: ResumenImportacion }
  | { tipo: 'errorServidor', mensaje: string }

type Props = {
  onStudents: () => void
  onAccounts?: () => void
  onImported?: () => void
  dependencias?: DependenciasInscripciones
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function InscripcionesScreen({ onStudents, onAccounts, onImported, dependencias }: Props) {
  const deps = useRef(dependencias ?? crearDependencias()).current
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' })
  const [soloErrores, setSoloErrores] = useState(false)
  const [descarga, setDescarga] = useState<'plantilla' | 'reporte' | null>(null)
  const [errorDescarga, setErrorDescarga] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const ocupado = estado.tipo === 'leyendo' || estado.tipo === 'confirmando'

  async function subir(event: ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0]
    event.target.value = ''
    if (!archivo || ocupado) return
    setSoloErrores(false)
    setEstado({ tipo: 'leyendo' })
    setEstado(await previsualizarImportacion({ nombre: archivo.name, contenido: await archivo.arrayBuffer() }, deps))
  }

  async function confirmar() {
    if (estado.tipo !== 'vistaPrevia' || !estado.vista.puedeConfirmar) return
    setEstado({ tipo: 'confirmando', vista: estado.vista })
    const resultado = await confirmarImportacion(estado.vista, deps)
    setEstado(resultado)
    if (resultado.tipo === 'importado') onImported?.()
  }

  async function generar(tipo: 'plantilla' | 'reporte') {
    if (descarga) return
    setDescarga(tipo)
    setErrorDescarga('')
    try {
      if (tipo === 'plantilla') {
        descargar(await deps.escritor.escribir(armarPlantilla(await deps.repositorio.cursos())), NOMBRE_PLANTILLA)
      } else if (estado.tipo === 'vistaPrevia') {
        const { vista } = estado
        descargar(await deps.escritor.escribir(armarReporteErrores(vista.crudas, vista.resultado)), nombreReporteErrores(vista.nombreArchivo))
      }
    } catch {
      setErrorDescarga('No se pudo generar el archivo. Intente nuevamente.')
    } finally {
      setDescarga(null)
    }
  }

  const reiniciar = () => { setEstado({ tipo: 'inicial' }); setSoloErrores(false) }
  const vista = estado.tipo === 'vistaPrevia' || estado.tipo === 'confirmando' ? estado.vista : null

  return <AppShell active="inscripciones" onStudents={() => { if (!ocupado) onStudents() }} onAccounts={onAccounts} onInscripciones={() => {}}>
    <div className="inscripciones-screen">
      <div className="page-heading">
        <div><h1>Inscripciones 2027</h1><p>Subí la planilla de reinscripción, revisá la vista previa y confirmá. No se guarda nada sin tu confirmación.</p></div>
        <div className="inscripciones-botones">
          <button type="button" className="btn btn-secondary" disabled={descarga !== null} onClick={() => { void generar('plantilla') }}>
            {descarga === 'plantilla' ? 'Generando plantilla...' : 'Descargar plantilla'}
          </button>
          <button type="button" className="btn" disabled={ocupado} onClick={() => input.current?.click()}><DesignIcon name="plus" />Subir planilla</button>
          <input ref={input} type="file" accept=".xlsx" className="visually-hidden" aria-label="Planilla de inscripciones (.xlsx)" onChange={event => { void subir(event) }} />
        </div>
      </div>

      {errorDescarga && <div role="alert" className="error-message">{errorDescarga}</div>}
      {estado.tipo === 'inicial' && <div className="panel inscripciones-vacio"><p>Descargá la plantilla oficial, completala con una fila por alumno y subila. Solo se aceptan archivos .xlsx de hasta 2 MB y 2.000 filas.</p></div>}
      {estado.tipo === 'leyendo' && <div role="status" className="panel inscripciones-vacio"><p>Revisando la planilla...</p></div>}
      {estado.tipo === 'errorArchivo' && <div role="alert" className="error-message">{estado.mensaje}</div>}
      {estado.tipo === 'errorServidor' && <div role="alert" className="error-message">{estado.mensaje}
        <button type="button" className="btn-link" onClick={reiniciar}>Volver</button></div>}
      {estado.tipo === 'importado' && <div role="status" className="success-message">
        Importación confirmada: {estado.resumen.alumnosCreados} alumnos creados y {estado.resumen.alumnosActualizados} actualizados;
        {' '}{estado.resumen.tutoresCreados} tutores creados y {estado.resumen.tutoresActualizados} actualizados.
        <button type="button" className="btn-link" onClick={reiniciar}>Subir otra planilla</button>
      </div>}
      {vista && <VistaPrevia vista={vista} soloErrores={soloErrores} confirmando={estado.tipo === 'confirmando'}
        descargandoReporte={descarga === 'reporte'} onSoloErrores={setSoloErrores} onConfirmar={() => { void confirmar() }}
        onDescargarReporte={() => { void generar('reporte') }} onSubirOtra={reiniciar} />}
    </div>
  </AppShell>
}
