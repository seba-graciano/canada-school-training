import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from '../AppContext'
import { supabase } from '../supabase'
import AppShell from '../ui/AppShell'
import { createAccount } from './createAccount'
import type { AccountInput, AccountRole } from './createAccount'
import { deleteAccount, listAccounts } from './accountDirectory'
import type { DirectoryAccount } from './accountDirectory'
import './accounts.css'

const emptyForm = { nombre: '', apellido: '', dni: '', email: '', telefono: '', password: '' }
const fields = [
  { name: 'nombre', label: 'Nombre', type: 'text', autocomplete: 'given-name', required: true },
  { name: 'apellido', label: 'Apellido', type: 'text', autocomplete: 'family-name', required: true },
  { name: 'email', label: 'Correo electrónico', type: 'email', autocomplete: 'email', required: true },
  { name: 'dni', label: 'DNI', type: 'text', autocomplete: 'off', required: true },
  { name: 'telefono', label: 'Teléfono (opcional)', type: 'tel', autocomplete: 'tel', required: false },
] as const

const roleLabels: Record<AccountRole, string> = { tutor: 'Tutor', admin: 'Administrador', secretaria: 'Secretaría' }
const roleDescriptions: Record<AccountRole, string> = {
  tutor: 'Puede consultar únicamente la información de sus alumnos vinculados. No puede gestionar pagos ni crear cuentas.',
  admin: 'Puede administrar alumnos, gestionar pagos y crear cuentas.',
  secretaria: 'Puede administrar alumnos y gestionar pagos. No puede crear cuentas.',
}
const roles: AccountRole[] = ['admin', 'secretaria', 'tutor']

type Props = { onBack: () => void; onCreated: (role: AccountRole) => void }

export default function AccountScreen({ onBack, onCreated }: Props) {
  const { user, userRole } = useApp()
  const [form, setForm] = useState(emptyForm)
  const [role, setRole] = useState<AccountRole>('tutor')
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([])
  const [total, setTotal] = useState(0)
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryError, setDirectoryError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DirectoryAccount | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [notice, setNotice] = useState('')
  const submitting = useRef(false)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const deleting = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const confirmationRef = useRef<HTMLElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestGeneration.current += 1 }
  }, [])

  useEffect(() => {
    const generation = ++requestGeneration.current
    setDirectoryLoading(true)
    setDirectoryError('')
    void listAccounts({ search, page }, async (name, args) => await supabase.rpc(name, args)).then(result => {
      if (!mounted.current || generation !== requestGeneration.current) return
      setDirectoryLoading(false)
      if ('error' in result) {
        setDirectoryError(result.error)
        return
      }
      setAccounts(result.accounts)
      setTotal(result.total)
      if (result.page !== page) setPage(result.page)
    })
    return () => { if (generation === requestGeneration.current) requestGeneration.current += 1 }
  }, [search, page, reloadKey])

  useEffect(() => {
    if (!openMenuId) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenuId(null)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuId(null)
        menuTriggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keydown)
    }
  }, [openMenuId])

  useEffect(() => {
    if (!deleteTarget) return
    cancelDeleteRef.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting.current) {
        setDeleteTarget(null)
        setDeleteError('')
        menuTriggerRef.current?.focus()
      }
      if (event.key !== 'Tab') return
      const focusable = confirmationRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [deleteTarget])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || userRole !== 'admin' || submitting.current || created) return
    if (form.password.length < 12) {
      setError('La contraseña debe tener al menos 12 caracteres.')
      return
    }
    if (form.password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (![form.nombre, form.apellido, form.email].every(value => value.trim())) {
      setError('Complete nombre, apellido y correo electrónico.')
      return
    }
    if (role === 'tutor' && !form.dni.trim()) {
      setError('Complete el DNI del tutor.')
      return
    }

    submitting.current = true
    setLoading(true)
    setError('')
    const common = {
      nombre: form.nombre.trim(), apellido: form.apellido.trim(),
      email: form.email.trim(), password: form.password,
    }
    const input: AccountInput = role === 'tutor'
      ? { ...common, user_role: role, dni: form.dni.trim(), telefono: form.telefono.trim() }
      : { ...common, user_role: role }
    const result = await createAccount(input, (name, options) => supabase.functions.invoke(name, options))
    if (!mounted.current) return
    submitting.current = false
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setForm(previous => ({ ...previous, password: '' }))
    setConfirmation('')
    setCreated(true)
    setReloadKey(value => value + 1)
    onCreated(role)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting.current) return
    deleting.current = true
    setDeleteLoading(true)
    setDeleteError('')
    const result = await deleteAccount(deleteTarget.id, (name, options) => supabase.functions.invoke(name, options))
    if (!mounted.current) return
    deleting.current = false
    setDeleteLoading(false)
    if ('error' in result) {
      setDeleteError(result.error)
      return
    }
    setNotice(`Se eliminó la cuenta ${deleteTarget.email ?? 'Sin correo'}.`)
    setDeleteTarget(null)
    const pageCountAfterDelete = Math.max(1, Math.ceil((total - 1) / 20))
    if (page > pageCountAfterDelete) setPage(pageCountAfterDelete)
    else setReloadKey(value => value + 1)
  }

  if (!user || userRole !== 'admin') {
    return <div className="account-screen" role="alert">No tiene permiso para crear cuentas.</div>
  }

  return (
    <AppShell active="accounts" onStudents={() => { if (!loading) onBack() }}>
      <div className="account-screen">
        <div className="page-heading account-heading">
          <div>
            <h1>Administración de cuentas</h1>
            <p>Gestioná quién puede ingresar y qué puede hacer dentro del sistema.</p>
          </div>
        </div>

        <div className="account-layout">
          <section className="panel account-roles" aria-labelledby="account-directory-title">
            <div className="panel-header account-panel-header">
              <div>
                <h2 id="account-directory-title">Cuentas registradas</h2>
                <small>Busque por correo y consulte el rol asignado.</small>
              </div>
            </div>
            <div className="account-directory-content">
              <label className="account-search-label" htmlFor="account-search">Buscar por correo electrónico</label>
              <input id="account-search" className="account-search" type="search" autoComplete="off"
                placeholder="Ingrese un correo" value={search}
                onChange={event => { setSearch(event.target.value); setPage(1); setNotice('') }} />
              {notice && <p className="account-notice" role="status">{notice}</p>}
              <div className="account-table-wrap" aria-busy={directoryLoading}>
                <table className="account-directory-table" aria-label="Cuentas registradas">
                  <thead><tr><th scope="col">Correo electrónico</th><th scope="col">Rol</th><th scope="col"><span className="visually-hidden">Acciones</span></th></tr></thead>
                  <tbody>
                    {directoryLoading ? <tr><td colSpan={3} className="account-table-message">Cargando cuentas...</td></tr>
                      : directoryError ? <tr><td colSpan={3} className="account-table-message">
                        <span role="alert">{directoryError}</span>
                        <button type="button" className="account-retry" onClick={() => setReloadKey(value => value + 1)}>Reintentar</button>
                      </td></tr>
                        : accounts.length === 0 ? <tr><td colSpan={3} className="account-table-message">No se encontraron cuentas.</td></tr>
                          : accounts.map(account => {
                            const currentUser = account.id === user.id
                            const email = account.email ?? 'Sin correo'
                            const label = account.user_role ? roleLabels[account.user_role] : 'Sin rol asignado'
                            return <tr key={account.id}>
                              <td className="account-email-cell">{email}</td>
                              <td><span className="account-role-badge">{label}</span></td>
                              <td className="account-action-cell">
                                {currentUser ? <span className="account-current-user">Cuenta actual</span> : (
                                  <div className="account-row-actions">
                                    <button type="button" className="account-menu-trigger" aria-haspopup="menu"
                                      aria-expanded={openMenuId === account.id} aria-label={`Acciones para ${email}`}
                                      onClick={event => {
                                        menuTriggerRef.current = event.currentTarget
                                        setOpenMenuId(value => value === account.id ? null : account.id)
                                      }}>
                                      <img src="/design/accounts/ellipsis.svg" alt="" width="18" height="18" />
                                    </button>
                                    {openMenuId === account.id && <div className="account-action-menu" role="menu" ref={menuRef}>
                                      <button type="button" role="menuitem" onClick={() => {
                                        setOpenMenuId(null)
                                        setDeleteError('')
                                        setDeleteTarget(account)
                                      }}>Eliminar cuenta {email}</button>
                                    </div>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          })}
                  </tbody>
                </table>
              </div>
              <div className="account-pagination" aria-label="Paginación de cuentas">
                <span>Página {page} de {Math.max(1, Math.ceil(total / 20))} · {total} cuentas</span>
                <div>
                  <button type="button" aria-label="Página anterior" disabled={directoryLoading || page <= 1}
                    onClick={() => setPage(value => Math.max(1, value - 1))}>Anterior</button>
                  <button type="button" aria-label="Página siguiente" disabled={directoryLoading || page >= Math.max(1, Math.ceil(total / 20))}
                    onClick={() => setPage(value => value + 1)}>Siguiente</button>
                </div>
              </div>
              <details className="account-role-details">
                <summary>Consultar permisos de cada rol</summary>
                <div className="account-role-list">
                  {roles.map(accountRole => <article className="account-role-card" key={accountRole}>
                    <div className="account-role-title"><h3>{roleLabels[accountRole]}</h3><span className="badge">Rol disponible</span></div>
                    <p>{roleDescriptions[accountRole]}</p>
                    {accountRole === 'tutor' && <p className="account-role-note">Los alumnos se vinculan desde el formulario de alumnos.</p>}
                  </article>)}
                </div>
              </details>
            </div>
          </section>

          <section className="panel account-create" aria-labelledby="account-title">
            <div className="account-create-content">
              <header className="account-create-heading">
                <h2 id="account-title">Crear cuenta</h2>
                <p>Autorice a una persona del equipo con los permisos necesarios.</p>
              </header>
              {created ? (
                <div role="status" className="success-message account-success">
                  <p><strong>Cuenta creada correctamente. Rol: {roleLabels[role]}.</strong></p>
                  <p>La nueva cuenta puede ingresar con su correo y la contraseña inicial.</p>
                  {role === 'tutor' && <p>Al volver al listado, el tutor estará disponible en el selector del formulario de alumnos. No tendrá alumnos visibles hasta que se le asignen.</p>}
                </div>
              ) : (
                <form onSubmit={handleSubmit} aria-busy={loading}>
                  {error && <p role="alert" className="error-message account-error">{error}</p>}
                  <fieldset disabled={loading} className="account-fields">
                    <legend className="account-legend">Datos de la cuenta</legend>
                    <label htmlFor="account-role" className="field">Rol
                      <select id="account-role" name="user_role" value={role} aria-describedby="account-role-description"
                        onChange={event => { setRole(event.target.value as AccountRole); setError('') }}>
                        <option value="tutor">Tutor</option>
                        <option value="admin">Administrador</option>
                        <option value="secretaria">Secretaría</option>
                      </select>
                      <span id="account-role-description" className="account-role-description">{roleDescriptions[role]}</span>
                      {role === 'tutor' && <span className="account-role-description">La nueva cuenta no tendrá alumnos visibles hasta que se le asignen desde el formulario de alumnos.</span>}
                    </label>
                    {fields.filter(field => role === 'tutor' || (field.name !== 'dni' && field.name !== 'telefono')).map(field => (
                      <label key={field.name} htmlFor={`account-${field.name}`} className={`field account-field-${field.name}`}>
                        {field.label}
                        <input id={`account-${field.name}`} name={field.name} type={field.type}
                          autoComplete={field.autocomplete} required={field.required}
                          value={form[field.name]} onChange={event => setForm(previous => ({ ...previous, [field.name]: event.target.value }))} />
                      </label>
                    ))}
                    <label htmlFor="account-password" className="field">Contraseña inicial
                      <input id="account-password" name="password" type="password" autoComplete="new-password"
                        required minLength={12} value={form.password} aria-describedby="account-password-hint"
                        onChange={event => setForm(previous => ({ ...previous, password: event.target.value }))} />
                      <small id="account-password-hint">Mínimo 12 caracteres.</small>
                    </label>
                    <label htmlFor="account-confirmation" className="field">Confirmar contraseña
                      <input id="account-confirmation" name="confirmation" type="password" autoComplete="new-password"
                        required minLength={12} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
                    </label>
                  </fieldset>
                  <div className="account-submit-wrap">
                    <button type="submit" className="btn account-submit" disabled={loading}>
                      <img src="/design/accounts/send.svg" alt="" width="18" height="18" />
                      {loading ? 'Creando cuenta...' : 'Crear cuenta'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
        {deleteTarget && <div className="account-confirmation-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !deleting.current) { setDeleteTarget(null); setDeleteError('') }
        }}>
          <section className="account-confirmation" role="alertdialog" aria-modal="true"
            aria-labelledby="account-delete-title" aria-describedby="account-delete-description" ref={confirmationRef}>
            <h2 id="account-delete-title">¿Eliminar la cuenta?</h2>
            <p id="account-delete-description">Se eliminará esta cuenta registrada:</p>
            <p className="account-confirmation-email">{deleteTarget.email ?? 'Sin correo'}</p>
            {deleteError && <p role="alert" className="error-message account-error">{deleteError}</p>}
            <div className="account-confirmation-actions">
              <button type="button" className="btn account-cancel-delete" disabled={deleteLoading}
                ref={cancelDeleteRef} onClick={() => { setDeleteTarget(null); setDeleteError(''); menuTriggerRef.current?.focus() }}>Cancelar</button>
              <button type="button" className="btn account-delete-confirm" disabled={deleteLoading} onClick={() => void confirmDelete()}>
                {deleteLoading ? 'Eliminando...' : 'Eliminar cuenta'}
              </button>
            </div>
          </section>
        </div>}
      </div>
    </AppShell>
  )
}
