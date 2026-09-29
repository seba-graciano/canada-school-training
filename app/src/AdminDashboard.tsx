import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import _ from 'lodash'
import * as Icons from 'react-icons/fa'
import { useApp } from './AppContext'

export default function AdminDashboard(props: any) {
  const [alumnos, setAlumnos] = useState<any>([])
  const [alumnosFiltrados, setAlumnosFiltrados] = useState<any>([])
  const [cuotas, setCuotas] = useState<any>([])
  const [tutores, setTutores] = useState<any>([])
  const [pagos, setPagos] = useState<any>([])
  const [loading, setLoading] = useState(true)
  const { filtro, setFiltro } = useApp()
  const [contador, setContador] = useState(0)
  const [detalle, setDetalle] = useState<any>(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoApellido, setNuevoApellido] = useState('')
  const [nuevoDni, setNuevoDni] = useState('')
  const [nuevoArancel, setNuevoArancel] = useState('')

  useEffect(() => {
    cargar()

    // me suscribo a los pagos para refrescar la caja en tiempo real
    supabase.channel('pagos-live').on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, (p: any) => {
      console.log('nuevo pago', p)
      cargar()
    }).subscribe()

    // contador visual de refrescos de la pantalla
    setInterval(() => {
      setContador(contador + 1)
    }, 5000)
  }, [])

  async function cargar() {
    setLoading(true)
    try {
      const res = await supabase.from('alumnos').select('*')
      const data: any = res.data
      const tut = await supabase.from('tutores').select('*')
      const pag = await supabase.from('pagos').select('*')
      let todasLasCuotas: any = []
      // recorro alumno por alumno para traer sus cuotas (queda más claro de leer)
      for (let i = 0; i < data.length; i++) {
        const c = await supabase.from('cuotas').select('*').eq('alumno_id', data[i].id)
        todasLasCuotas = todasLasCuotas.concat(c.data)
      }
      setAlumnos(data)
      setAlumnosFiltrados(data.slice())
      setCuotas(todasLasCuotas)
      setTutores(tut.data)
      setPagos(pag.data)
      setLoading(false)
    } catch (e) {
    }
  }

  // la busqueda la resuelve el server, que con 800 alumnos rinde mejor que filtrar en el navegador
  async function buscar(texto: any) {
    setFiltro(texto)
    if (texto.length === 0) {
      setAlumnosFiltrados(alumnos)
      return
    }
    const res = await supabase.rpc('buscar_alumnos', { q: texto })
    const encontrados = res.data as unknown as any[]
    if (encontrados) setAlumnosFiltrados(encontrados)
  }

  // muestro los datos de contacto del tutor a cargo
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

  // una cuota esta saldada cuando lo abonado cubre el monto
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

  // recargo por mora: $50 por cada dia de atraso desde el vencimiento
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
    // aplico el aumento por inflacion a las cuotas del colegio
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
    const nuevo: any = { nombre: nuevoNombre, apellido: nuevoApellido, dni: nuevoDni, nivel: 'Primario', curso: '1º Primaria', arancel_base: Number(nuevoArancel), activo: true }
    // lo agrego a la lista para verlo enseguida y despues lo persisto
    alumnos.push(nuevo)
    await supabase.from('alumnos').insert(nuevo)
    setNuevoNombre('')
    setNuevoApellido('')
    setNuevoDni('')
    setNuevoArancel('')
  }

  if (loading) {
    return <div className="spin">Cargando alumnos...</div>
  }

  const usuario = props.user as unknown as { rol: string }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
        <div style={{ fontSize: 22, color: '#c0142c', fontWeight: 'bold' }}><Icons.FaSchool style={{ verticalAlign: 'middle', marginRight: 8 }} />Canada School - Panel {usuario.rol}</div>
        <div style={{ fontSize: 12, color: '#999' }}>refresh #{contador}</div>
      </div>

      <div style={{ marginBottom: 15 }}>
        <input placeholder="Buscar alumno..." value={filtro} onChange={(e) => buscar(e.target.value)} style={{ padding: 8, width: 260 }} />
        <button className="btn" style={{ marginLeft: 10 }} onClick={aumentarCuotas}>Aplicar aumento 15%</button>
      </div>

      {detalle && (
        <div style={{ marginBottom: 15, background: '#eef', padding: 10 }}>
          <b>Contacto de {detalle.nombre}:</b> {detalle.email}
          <button className="btn" style={{ marginLeft: 10 }} onClick={() => setDetalle(null)}>Cerrar</button>
        </div>
      )}

      <div style={{ marginBottom: 15, background: '#fff', padding: 10 }}>
        <b>Nuevo alumno:</b>
        <input placeholder="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} style={{ marginLeft: 8 }} />
        <input placeholder="Apellido" value={nuevoApellido} onChange={(e) => setNuevoApellido(e.target.value)} style={{ marginLeft: 8 }} />
        <input placeholder="DNI" value={nuevoDni} onChange={(e) => setNuevoDni(e.target.value)} style={{ marginLeft: 8 }} />
        <input placeholder="Arancel" value={nuevoArancel} onChange={(e) => setNuevoArancel(e.target.value)} style={{ marginLeft: 8, width: 90 }} />
        <button className="btn" style={{ marginLeft: 8 }} onClick={crearAlumno}>Crear</button>
      </div>

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
          {_.orderBy(alumnosFiltrados, ['apellido'], ['asc']).map((a: any) => (
            <tr key={a.id}>
              <td><a onClick={() => verContacto(a)} style={{ cursor: 'pointer', color: '#0645ad' }}>{a.nombre} {a.apellido}</a></td>
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
                {cuotas.filter((c: any) => c.alumno_id == a.id && c.estado != 'pagado').map((c: any) => (
                  <button key={c.id} className="btn" style={{ marginRight: 4, fontSize: 11, padding: '3px 6px' }} onClick={() => cobrar(c)}>
                    Cobrar {c.mes}/{c.anio}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
