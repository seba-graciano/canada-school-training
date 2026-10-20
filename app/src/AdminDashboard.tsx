import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { useApp } from './AppContext'
import AccountScreen from './accounts/AccountScreen'
import AppShell from './ui/AppShell'
import DesignIcon from './ui/DesignIcon'
import PaymentScreen from './payments/PaymentScreen'
import type { Student } from './payments/PaymentScreen'
import { money } from './payments/installments'
import './dashboard.css'

const PAGE_SIZE = 50
const courses: Record<string, string[]> = {
  Inicial: ['Inicial'],
  Primario: ['1º Primaria', '2º Primaria', '3º Primaria', '4º Primaria', '5º Primaria', '6º Primaria'],
  Secundario: ['1º Secundaria', '2º Secundaria', '3º Secundaria', '4º Secundaria', '5º Secundaria', '6º Secundaria'],
}
const emptyStudent = { nombre: '', apellido: '', dni: '', arancel: '', tutor: '', nivel: 'Primario', curso: '1º Primaria' }

export default function AdminDashboard() {
  const { userRole, setFiltro } = useApp()
  const canManage = userRole === 'admin' || userRole === 'secretaria'
  const [alumnos, setAlumnos] = useState<Student[]>([])
  const [tutores, setTutores] = useState<{ id: number; nombre: string; apellido: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({ query: '', level: '', course: '', debt: '' })
  const [draftFilters, setDraftFilters] = useState({ level: '', course: '', debt: '' })
  const [currentPage, setCurrentPage] = useState(1)
  const [accountScreen, setAccountScreen] = useState(false)
  const [student, setStudent] = useState<Student | null>(null)
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyStudent)
  const [increasing, setIncreasing] = useState(false)
  const mounted = useRef(false)
  const dashboardRequest = useRef(0)
  const createLock = useRef(false)
  const increaseLock = useRef(false)

  const filtered = useMemo(() => {
    const query = filters.query.toLocaleLowerCase()
    return alumnos.filter(item => (!query || `${item.nombre} ${item.apellido} ${item.apellido} ${item.nombre} ${item.dni}`.toLocaleLowerCase().includes(query))
      && (!filters.level || item.nivel === filters.level)
      && (!filters.course || item.curso === filters.course)
      && (!filters.debt || (filters.debt === 'debt' ? Number(item.deuda) > 0 : Number(item.deuda) <= 0)))
      .sort((a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
  }, [alumnos, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(currentPage, totalPages)
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    mounted.current = true
    void cargar()
    if (canManage) void cargarTutores()
    const channel = supabase.channel('pagos-live').on('postgres_changes',
      { event: '*', schema: 'public', table: 'pagos' }, () => { void cargar() }).subscribe()
    return () => {
      mounted.current = false
      dashboardRequest.current += 1
      void supabase.removeChannel(channel)
    }
  }, [canManage])

  async function cargar() {
    if (!mounted.current) return
    const request = ++dashboardRequest.current
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase.rpc('dashboard_alumnos')
      if (!mounted.current || request !== dashboardRequest.current) return
      if (error) throw error
      setAlumnos(data ?? [])
    } catch (error) {
      if (mounted.current && request === dashboardRequest.current) {
        console.error('Error cargando dashboard:', error)
        setError('No se pudieron actualizar los alumnos. Reintentá la consulta.')
      }
    } finally {
      if (mounted.current && request === dashboardRequest.current) setLoading(false)
    }
  }

  async function cargarTutores() {
    const { data, error } = await supabase.from('tutores').select('id, nombre, apellido, email')
    if (mounted.current && !error) setTutores(data ?? [])
  }

  function search(event: FormEvent) {
    event.preventDefault()
    setFilters({ ...draftFilters, query: searchQuery.trim() })
    setFiltro(searchQuery)
    setCurrentPage(1)
  }

  async function crearAlumno(event: FormEvent) {
    event.preventDefault()
    if (!canManage || createLock.current) return
    if (!form.tutor) { setError('Debe seleccionar un tutor'); return }
    if (!courses[form.nivel]?.includes(form.curso)) { setError('Curso inválido para el nivel seleccionado'); return }
    createLock.current = true
    setCreating(true)
    setError('')
    try {
      const { error } = await supabase.from('alumnos').insert({
        nombre: form.nombre, apellido: form.apellido, dni: form.dni,
        nivel: form.nivel, curso: form.curso, tutor_id: Number(form.tutor),
        arancel_base: Math.round(Number(form.arancel) * 100), activo: true,
      }).select().single()
      if (error) throw error
      if (!mounted.current) return
      setForm(emptyStudent)
      setShowForm(false)
      setNotice('Alumno creado')
      void cargar()
    } catch (error) {
      if (mounted.current) setError(`Error al crear alumno: ${error instanceof Error ? error.message : 'No se pudo guardar. Conservamos los datos ingresados.'}`)
    } finally {
      createLock.current = false
      if (mounted.current) setCreating(false)
    }
  }

  async function aumentarCuotas() {
    if (!canManage || increaseLock.current) return
    if (!window.confirm('Se aplicará un aumento del 15 % a todas las cuotas pendientes. ¿Continuar?')) return
    increaseLock.current = true
    setIncreasing(true)
    setError('')
    try {
      const { data, error } = await supabase.rpc('aumentar_cuotas_pendientes_15')
      if (error) throw error
      if (!mounted.current) return
      setNotice(`Aumento aplicado a ${data} cuotas pendientes`)
      void cargar()
    } catch (error) {
      if (mounted.current) setError(`Error aplicando aumento: ${error instanceof Error ? error.message : 'Intentá nuevamente.'}`)
    } finally {
      increaseLock.current = false
      if (mounted.current) setIncreasing(false)
    }
  }

  function back() { if (!paymentBusy) setStudent(null) }
  const currentStudent = student && (alumnos.find(item => item.id === student.id) ?? student)
  if (accountScreen && userRole === 'admin') return <AccountScreen onBack={() => setAccountScreen(false)} onCreated={role => { if (role === 'tutor') void cargarTutores() }} />

  return <AppShell active="students" section={student ? 'Cobro' : undefined} onStudents={back} onAccounts={() => { if (!paymentBusy) { setStudent(null); setAccountScreen(true) } }}>
    {currentStudent ? <PaymentScreen key={currentStudent.id} student={currentStudent} canCollect={canManage} onBack={back} onRefresh={() => { void cargar() }} onBusy={setPaymentBusy} /> : <>
      <div className="page-heading"><div><h1>{userRole === 'tutor' ? 'Mis alumnos' : 'Administración de alumnos'}</h1><p>Consultá la situación de cada alumno{canManage ? ' y registrá sus pagos.' : ' y el detalle de sus cuotas.'}</p></div>
        {canManage && <button type="button" className="btn" onClick={() => setShowForm(previous => !previous)} aria-expanded={showForm} aria-controls="student-form"><DesignIcon name="plus" />Nuevo alumno</button>}
      </div>
      {error && <div role="alert" className="error-message">{error}<button type="button" className="btn-link" onClick={() => { void cargar() }}>Reintentar</button></div>}
      {notice && <div role="status" className="success-message">{notice}</div>}
      {showForm && canManage && <section id="student-form" className="panel panel-padding new-student">
        <div className="panel-header"><h2>Nuevo alumno</h2><button className="btn-link" type="button" disabled={creating} onClick={() => setShowForm(false)}>Cerrar</button></div>
        <form onSubmit={crearAlumno}><fieldset disabled={creating} className="form-grid">
          {(['nombre', 'apellido', 'dni', 'arancel'] as const).map(key => <label className="field" key={key}>{({ nombre: 'Nombre', apellido: 'Apellido', dni: 'DNI', arancel: 'Arancel' })[key]}<input type={key === 'arancel' ? 'number' : 'text'} step={key === 'arancel' ? '0.01' : undefined} value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
          <label className="field">Nivel<select value={form.nivel} onChange={event => setForm(previous => ({ ...previous, nivel: event.target.value, curso: courses[event.target.value][0] }))}>{Object.keys(courses).map(level => <option key={level}>{level}</option>)}</select></label>
          <label className="field">Curso<select value={form.curso} onChange={event => setForm(previous => ({ ...previous, curso: event.target.value }))}>{courses[form.nivel].map(course => <option key={course}>{course}</option>)}</select></label>
          <label className="field">Tutor<select value={form.tutor} onChange={event => setForm(previous => ({ ...previous, tutor: event.target.value }))}><option value="">Seleccionar tutor...</option>{tutores.map(tutor => <option key={tutor.id} value={tutor.id}>{tutor.nombre} {tutor.apellido}</option>)}</select></label>
          <div className="form-actions"><button className="btn" type="submit" disabled={creating}>{creating ? 'Guardando...' : 'Crear alumno'}</button></div>
        </fieldset></form>
      </section>}
      <form onSubmit={search} className="panel student-filters">
        <label className="field search-field">Buscar alumno<span className="search-control"><input placeholder="Apellido, nombre o DNI" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} /><DesignIcon name="search" /></span></label>
        <label className="field">Nivel<select value={draftFilters.level} onChange={event => setDraftFilters(previous => ({ ...previous, level: event.target.value, course: '' }))}><option value="">Todos los niveles</option>{[...new Set(alumnos.map(item => item.nivel))].sort().map(level => <option key={level}>{level}</option>)}</select></label>
        <label className="field">Curso<select value={draftFilters.course} onChange={event => setDraftFilters(previous => ({ ...previous, course: event.target.value }))}><option value="">Todos los cursos</option>{[...new Set(alumnos.filter(item => !draftFilters.level || item.nivel === draftFilters.level).map(item => item.curso))].sort().map(course => <option key={course}>{course}</option>)}</select></label>
        <label className="field">Estado de pago<select value={draftFilters.debt} onChange={event => setDraftFilters(previous => ({ ...previous, debt: event.target.value }))}><option value="">Todos los estados</option><option value="clear">Sin deuda</option><option value="debt">Con deuda</option></select></label>
        <button type="submit" className="btn btn-secondary">Buscar</button>
      </form>
      <section className="panel students-list" aria-label="Listado de alumnos" aria-busy={loading}>
        <div className="panel-header"><h2>Alumnos</h2><small>{loading ? 'Actualizando...' : 'Orden: apellido A–Z'}</small></div>
        {loading && !alumnos.length ? <div className="spin">Cargando alumnos...</div> : !filtered.length ? <div className="empty-state"><h3>No se encontraron alumnos</h3><p>Revisá la búsqueda o limpiá los filtros para volver al listado.</p><button type="button" className="btn btn-secondary" onClick={() => { setSearchQuery(''); setFiltro(''); setFilters({ query: '', level: '', course: '', debt: '' }); setDraftFilters({ level: '', course: '', debt: '' }); setCurrentPage(1) }}>Limpiar filtros</button></div> : <>
          <div className="student-table"><table><thead><tr><th>Alumno / DNI</th><th>Nivel / Curso</th><th className="numeric">Arancel</th><th className="numeric">Saldadas</th><th>Estado</th><th className="numeric">Deuda total</th><th className="numeric">Acción</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}>
            <td><button type="button" className="student-name" onClick={() => setStudent(item)}>{item.nombre} {item.apellido}</button><small>DNI {item.dni}</small></td><td>{item.nivel}<small>{item.curso}</small></td><td className="numeric">{money(Number(item.arancel_base))}</td><td className="numeric">{item.cuotas_saldadas}</td><td><span className={`badge ${Number(item.deuda) > 0 ? 'badge-warning' : 'badge-success'}`}>{Number(item.deuda) > 0 ? 'Con deuda' : 'Sin deuda'}</span></td><td className="numeric"><strong>{money(Number(item.deuda))}</strong></td><td className="numeric"><button type="button" className="btn-link" onClick={() => setStudent(item)}>{canManage && Number(item.deuda) > 0 ? 'Cobrar' : 'Ver ficha'}<DesignIcon name="chevron" /></button></td>
          </tr>)}</tbody></table></div>
          <div className="student-cards">{rows.map(item => <article className="student-card" key={item.id}><div className="student-card-heading"><div><h3>{item.nombre} {item.apellido}</h3><small>DNI {item.dni}</small></div><span className={`badge ${Number(item.deuda) > 0 ? 'badge-warning' : 'badge-success'}`}>{Number(item.deuda) > 0 ? 'Con deuda' : 'Sin deuda'}</span></div><p className="student-school">{item.nivel} · {item.curso} · {item.cuotas_saldadas} cuotas saldadas</p><dl><div><dt>Arancel</dt><dd>{money(Number(item.arancel_base))}</dd></div><div><dt>Deuda total</dt><dd className="card-debt">{money(Number(item.deuda))}</dd></div></dl><button type="button" className="btn btn-secondary" onClick={() => setStudent(item)}><DesignIcon name="chevron" />{canManage && Number(item.deuda) > 0 ? 'Cobrar' : 'Ver ficha del alumno'}</button></article>)}</div>
          <div className="pagination"><span>Mostrando {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} alumnos</span><div><button className="btn btn-secondary" type="button" disabled={page === 1} onClick={() => setCurrentPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages}</span><button className="btn btn-secondary" type="button" disabled={page === totalPages} onClick={() => setCurrentPage(page + 1)}>Siguiente</button></div></div>
        </>}
      </section>
      <p className="list-footnote">Hermanos, descuento, mora y detalle de cuotas están disponibles en la ficha del alumno.</p>
      {canManage && <section className="panel fee-management"><DesignIcon name="sliders" /><div><h3>Gestión de aranceles</h3><p>Aplicá el aumento vigente a todas las cuotas pendientes.</p></div><button type="button" className="btn btn-secondary" onClick={aumentarCuotas} disabled={increasing}>{increasing ? 'Aplicando aumento...' : 'Aplicar aumento 15%'}</button></section>}
    </>}
  </AppShell>
}
