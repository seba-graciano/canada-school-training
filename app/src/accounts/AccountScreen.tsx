import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from '../AppContext'
import { supabase } from '../supabase'
import AppShell from '../ui/AppShell'
import { createAccount } from './createAccount'
import type { AccountInput, AccountRole } from './createAccount'
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
  const submitting = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

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
    onCreated(role)
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
          <section className="panel account-roles" aria-labelledby="account-roles-title">
            <div className="panel-header account-panel-header">
              <div>
                <h2 id="account-roles-title">Roles de acceso</h2>
                <small>Permisos disponibles para las cuentas del sistema.</small>
              </div>
            </div>
            <div className="account-role-list">
              {roles.map(accountRole => (
                <article className="account-role-card" key={accountRole}>
                  <div className="account-role-title">
                    <h3>{roleLabels[accountRole]}</h3>
                    <span className="badge">Rol disponible</span>
                  </div>
                  <p>{roleDescriptions[accountRole]}</p>
                  {accountRole === 'tutor' && (
                    <p className="account-role-note">Los alumnos se vinculan desde el formulario de alumnos.</p>
                  )}
                </article>
              ))}
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
      </div>
    </AppShell>
  )
}
