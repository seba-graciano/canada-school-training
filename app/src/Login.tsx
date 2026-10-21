import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from './supabase'
import { decodeJwtPayload } from './auth/session'
import Brand from './ui/Brand'
import './login.css'

type LoginProps = {
  onLogin: (user: {
    id: string
    email: string | undefined
    user_role: string
    tutor_id: unknown
  }) => void
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function entrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: pass,
      })
      if (authError) throw authError

      // Get the session to extract custom claims from JWT
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session after login')

      // Decode JWT to get custom claims (user_role, tutor_id)
      const payload = decodeJwtPayload(session.access_token)
      const userRole = payload?.user_role
      const tutorId = payload?.tutor_id

      if (typeof userRole !== 'string' || !['admin', 'secretaria', 'tutor'].includes(userRole)) {
        await supabase.auth.signOut()
        throw new Error('Usuario sin rol asignado. Contacte al administrador.')
      }

      onLogin({
        id: data.user.id,
        email: data.user.email,
        user_role: userRole,
        tutor_id: tutorId,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-intro" aria-label="Canada School">
        <Brand />
        <div className="login-intro-copy">
          <span className="login-accent" aria-hidden="true" />
          <h1>Gestión Escolar</h1>
          <p>Accedé a la gestión de alumnos, cuotas y cuentas de Canada School.</p>
          <div className="login-access-note">
            <img src="/design/login/shield-desktop.svg" width="18" height="18" alt="" />
            <span>Uso exclusivo del personal autorizado</span>
          </div>
        </div>
        <p className="login-intro-footer">Canada School · Gestión escolar</p>
      </section>

      <section className="login-content" aria-label="Ingreso al portal">
        <header className="login-mobile-header">
          <Brand />
        </header>
        <div className="login-card">
          <header className="login-heading">
            <p className="login-eyebrow">Portal administrativo</p>
            <h2>Ingresá a tu cuenta</h2>
            <p>Usá tu correo institucional y contraseña.</p>
          </header>

          <form className="login-form" onSubmit={entrar}>
            {error && <div className="error-message" role="alert">{error}</div>}
            <label className="field">
              <span>Correo electrónico</span>
              <span className="login-input-wrap">
                <input
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-label="Correo electrónico"
                />
                <img src="/design/login/mail.svg" width="18" height="18" alt="" aria-hidden="true" />
              </span>
            </label>

            <label className="field">
              <span>Contraseña</span>
              <span className="login-input-wrap">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pass}
                  onChange={(event) => setPass(event.target.value)}
                  aria-label="Contraseña"
                />
                <img src="/design/login/eye-off.svg" width="18" height="18" alt="" aria-hidden="true" />
              </span>
            </label>

            <button className="btn login-submit" type="submit" disabled={loading}>
              <img src="/design/login/arrow-right.svg" width="18" height="18" alt="" aria-hidden="true" />
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <div className="login-guidance">
            <p>¿Necesitás acceso?</p>
            <span>Contactá al administrador de Canada School para recibir asistencia.</span>
          </div>
        </div>
        <div className="login-mobile-access-note">
          <img src="/design/login/shield-mobile.svg" width="16" height="16" alt="" />
          <span>Solo personal autorizado · Canada School</span>
        </div>
      </section>
    </main>
  )
}
