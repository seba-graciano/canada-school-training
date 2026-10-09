import { useState } from 'react'
import { supabase } from './supabase'

export default function Login(props: any) {
  const [email, setEmail] = useState('secretaria@canadaschool.edu.ar')
  const [pass, setPass] = useState('1234')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function entrar() {
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
      const payload = JSON.parse(atob(session.access_token.split('.')[1]))
      const userRole = payload.user_role
      const tutorId = payload.tutor_id

      if (!userRole) {
        await supabase.auth.signOut()
        throw new Error('Usuario sin rol asignado. Contacte al administrador.')
      }

      props.onLogin({
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
    <div style={{ maxWidth: 340, margin: '80px auto', background: '#fff', padding: 30 }}>
      <div style={{ textAlign: 'center', fontSize: 22, color: '#c0142c', fontWeight: 'bold' }}>Canada School</div>
      <div style={{ textAlign: 'center', fontSize: 11, color: '#999', marginBottom: 20 }}>PEDRO GOYENA - CABALLITO</div>
      {error && <div style={{ color: '#c0142c', marginBottom: 10, fontSize: 13 }}>{error}</div>}
      <div>Email</div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      <div>Contraseña</div>
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      <button className="btn" style={{ width: '100%' }} onClick={entrar} disabled={loading}>
        {loading ? 'Ingresando...' : 'Ingresar'}
      </button>
    </div>
  )
}