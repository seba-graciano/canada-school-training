import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import _ from 'lodash'
import * as Icons from 'react-icons/fa'
import { useApp } from './AppContext'

const PAGE_SIZE = 50

export default function AdminDashboard() {
  const [alumnos, setAlumnos] = useState<any>([])
  const [alumnosFiltrados, setAlumnosFiltrados] = useState<any>([])
  const [cuotas, setCuotas] = useState<any>([])
  const [tutores, setTutores] = useState<any>([])
  const [pagos, setPagos] = useState<any>([])
  const [loading, setLoading] = useState(true)
  const { user, userRole, logout, setFiltro } = useApp()
  const [contador, setContador] = useState(0)
  const [detalle, setDetalle] = useState<any>(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoDni, setNuevoDni] = useState('')
  const [nuevoArancel, setNuevoArancel] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const isAdmin = userRole === 'admin'
  const isSecretaria = userRole === 'secretaria'
  const canManageCuotas = isAdmin || isSecretaria
  const canCreateAlumno = isAdmin || isSecretaria

  useEffect(() => {
    cargar()

    const channel = supabase.channel('pagos-live').on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pagos' },
      (p: any) => {
        console.log('nuevo pago', p)
        cargar()
      }
    ).subscribe()

    const intervalId = setInterval(() => {
      setContador(c => c + 1)
    }, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(intervalId)
    }
  }, [])

  async function cargar() {
    setLoading(true)
    try {
      const res = await supabase.from('alumnos').select('*')
      const data: any = res.data
      const tut = await supabase.from('tutores').select('*')
      const pag = await supabase.from('pagos').select('*')

      const alumnoIds = data.map((a: any) => a.id)
      const cuotasRes = await supabase
        .from('cuotas')
        .select('*')
        .in('alumno_id', alumnoIds)
      const todasLasCuotas = cuotasRes.data || []

      setAlumnos(data)
      setAlumnosFiltrados(data)
      setCuotas(todasLasCuotas)
      setTutores(tut.data)
      setPagos(pag.data)
      setCurrentPage(1)
      setTotalPages(Math.ceil(data.length / PAGE_SIZE))
      setLoading(false)
    } catch (e) {
      setLoading(false)
    }
  }

  async function buscar(texto: string) {
    setSearchQuery(texto)
    setFiltro(texto)
    setCurrentPage(1)

    if (texto.length === 0) {
      setAlumnosFiltrados(alumnos)
      setTotalPages(Math.ceil(alumnos.length / PAGE_SIZE))
      return
    }

    try {
      const res = await supabase.rpc('buscar_alumnos', { q: texto })
      const encontrados = (res.data as unknown as any[]) || []
      setAlumnosFiltrados(encontrados)
      setTotalPages(Math.ceil(encontrados.length / PAGE_SIZE))
    } catch (e) {
      setAlumnosFiltrados([])
      setTotalPages(1)
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    buscar(searchQuery)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      buscar(searchQuery)
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  function previousPage() {
    goToPage(currentPage - 1)
  }

  function nextPage() {
    goToPage(currentPage + 1)
  }

  function getPaginatedAlumnos() {
    const start = (currentPage - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    return _.orderBy(alumnosFiltrados, ['apellido'], ['asc']).slice(start, end)
  }

  function verContacto(al: any) {
    const t = tutores.find((x: any) => x.id == al.tutor_id)
    const email = (t as unknown as { email: string }).email.toLowerCase()
    setDetalle({ nombre: al.nombre + ' ' + al.apellido, email: email })
  }

  function pagadoDe(cuota: any) {
    let s = 0
    for (let i = 0; i < pagos.length; i++) {
      if (pagos[i].cuota_id == cuota.id) s = s + pagos[i].monto_abonado
    }
    return s
  }

  function estaSaldada(cuota: any) {
    return pagadoDe(cuota) === cuota.monto
  }

  function saldadasDe(al: any) {
    let n = 0
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id && estaSaldada(cuotas[i])) n++
    }
    return n
  }

  function deudaDe(al: any) {
    let total = 0
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id) {
        if (cuotas[i].estado != 'pagado') {
          total = total + cuotas[i].monto + cuotas[i].recargo - cuotas[i].descuento
        }
      }
    }
    return total
  }

  function hermanos(al: any) {
    if (al.tutor_id == null) return 1
    let n = 0
    for (let i = 0; i < alumnos.length; i++) {
      if (alumnos[i].tutor_id == al.tutor_id) n++
    }
    return n
  }

  function descuentoHermano(al: any) {
    const h = hermanos(al)
    if (h == 2) return 0.1
    if (h >= 3) return 0.2
    return 0
  }

  function calcularMora(cuota: any) {
    const partes = String(cuota.fecha_vencimiento).split('/')
    const venc: any = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]))
    const hoy: any = new Date()
    const dias = Math.floor((hoy - venc) / (1000 * 60 * 60 * 24))
    if (dias > 0) return dias * 50
    return 0
  }

  function moraDe(al: any) {
    let total = 0
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id) total = total + calcularMora(cuotas[i])
    }
    return total
  }

  async function aumentarCuotas() {
    for (let i = 0; i < cuotas.length; i++) {
      await supabase.from('cuotas').update({ monto: cuotas[i].monto * 1.15 }).eq('id', cuotas[i].id)
    }
    alert('Aumento aplicado')
    cargar()
  }

  async function cobrar(cuota: any) {
    await supabase.from('pagos').insert({
      cuota_id: cuota.id,
      monto_abonado: cuota.monto + cuota.recargo - cuota.descuento,
      medio_pago: 'efectivo',
      fecha_pago: new Date().toLocaleDateString(),
    })
    await supabase.from('cuotas').update({ estado: 'pagado' }).eq('id', cuota.id)
    alert('Pago registrado')
    cargar()
  }

  async function crearAlumno() {
    const nuevo: any = {
      nombre: nuevoNombre,
      apellido: nuevoApellido,
      dni: nuevoDni,
      nivel: 'Primario',
      curso: '1º Primaria',
      arancel_base: Number(nuevoArancel),
      activo: true
    }
    alumnos.push(nuevo)
    await supabase.from('alumnos').insert(nuevo)
    setNuevoNombre('')
    setNuevoApellido('')
    setNuevoDni('')
    setNuevoArancel('')
    cargar()
  }

  if (loading) {
    return <div className="spin">Cargando alumnos...</div>
  }

  const paginatedAlumnos = getPaginatedAlumnos()
  const totalRecords = alumnosFiltrados.length
  const startRecord = totalRecords > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0
  const endRecord = Math.min(currentPage * PAGE_SIZE, totalRecords)
  const roleLabel = userRole === 'admin' ? 'Administrador' : userRole === 'secretaria' ? 'Secretaría' : 'Tutor'

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
        <div style={{ fontSize: 22, color: '#c0142c', fontWeight: 'bold' }}>
          <Icons.FaSchool style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Canada School - Panel {roleLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <div style={{ fontSize: 12, color: '#999' }}>
            {user?.email} <span style={{ marginLeft: 8, color: '#c0142c' }}>●</span>
          </div>
          <button className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={logout}>Salir</button>
          <div style={{ fontSize: 12, color: '#999' }}>refresh #{contador}</div>
        </div>
      </div>

      <div style={{ marginBottom: 15 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Buscar alumno..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ padding: 8, width: 260 }}
          />
          <button type="submit" className="btn">Buscar</button>
          {canManageCuotas && (
            <button className="btn" style={{ marginLeft: 10 }} onClick={aumentarCuotas}>Aplicar aumento 15%</button>
          )}
        </form>
      </div>

      {detalle && (
        <div style={{ marginBottom: 15, background: '#eef', padding: 10 }}>
          <b>Contacto de {detalle.nombre}:</b> {detalle.email}
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => setDetalle(null)}>Cerrar</button>
        </div>
      )}

      {canCreateAlumno && (
        <div style={{ marginBottom: 15, background: '#fff', padding: 10 }}>
          <b>Nuevo alumno:</b>
          <input placeholder="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} style={{ marginLeft: 8 }} />
          <input placeholder="Apellido" value={nuevoApellido} onChange={(e) => setNuevoApellido(e.target.value)} style={{ marginLeft: 8 }} />
          <input placeholder="DNI" value={nuevoDni} onChange={(e) => setNuevoDni(e.target.value)} style={{ marginLeft: 8 }} />
          <input placeholder="Arancel" value={nuevoArancel} onChange={(e) => setNuevoArancel(e.target.value)} style={{ marginLeft: 8, width: 90 }} />
          <button className="btn" style={{ marginLeft: 8 }} onClick={crearAlumno}>Crear</button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>DNI</th>
            <th>Nivel</th>
            <th>Curso</th>
            <th>Hermanos</th>
            <th>Desc.</th>
            <th>Arancel</th>
            <th>Saldadas</th>
            <th>Mora</th>
            <th>Deuda</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {paginatedAlumnos.map((a: any) => (
            <tr key={a.id}>
              <td>
                <a onClick={() => verContacto(a)} style={{ cursor: 'pointer', color: '#0645ad' }}>
                  {a.nombre} {a.apellido}
                </a>
              </td>
              <td>{a.dni}</td>
              <td>{a.nivel}</td>
              <td>{a.curso}</td>
              <td>{hermanos(a)}</td>
              <td>{descuentoHermano(a) * 100}%</td>
              <td>${a.arancel_base}</td>
              <td>{saldadasDe(a)}</td>
              <td style={{ color: moraDe(a) > 0 ? '#c0142c' : '#999' }}>${moraDe(a)}</td>
              <td style={{ color: deudaDe(a) > 0 ? 'red' : 'green' }}>${deudaDe(a)}</td>
              <td>
                {canManageCuotas && cuotas.filter((c: any) => c.alumno_id == a.id && c.estado != 'pagado').map((c: any) => (
                  <button key={c.id} className="btn" style={{ marginRight: 4, fontSize: 11, padding: '3px 6px' }} onClick={() => cobrar(c)}>
                    Cobrar {c.mes}/{c.anio}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalRecords > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, padding: 10 }}>
          <div style={{ fontSize: 14, color: '#666' }}>
            Mostrando {startRecord} - {endRecord} de {totalRecords} alumnos ({totalPages} página{totalPages !== 1 ? 's' : ''})
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn"
              onClick={previousPage}
              disabled={currentPage === 1}
              style={{ display: currentPage === 1 ? 'none' : 'inline-block' }}
            >
              Anterior
            </button>
            <span style={{ minWidth: 60, textAlign: 'center' }}>
              Página {currentPage} de {totalPages}
            </span>
            <button
              className="btn"
              onClick={nextPage}
              disabled={currentPage === totalPages}
              style={{ display: currentPage === totalPages ? 'none' : 'inline-block' }}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}