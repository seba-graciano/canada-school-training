import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'
import { decodeJwtPayload } from './auth/session'

const AppContext = createContext<any>(null)
const allowedRoles = new Set(['admin', 'secretaria', 'tutor'])

export function AppProvider(props: any) {
  const [user, setUser] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [tutorId, setTutorId] = useState<number | null>(null)
  const [filtro, setFiltro] = useState('')
  const [alumnos, setAlumnos] = useState<any>([])
  const [cuotas, setCuotas] = useState<any>([])
  const [logoutError, setLogoutError] = useState('')

  // Restore session on mount
  useEffect(() => {
    let active = true
    let authEventCount = 0
    const applySession = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null) => {
      if (!active) return
      setUser(null)
      setUserRole(null)
      setTutorId(null)
      setAlumnos([])
      setCuotas([])

      if (!session) return
      const payload = decodeJwtPayload(session.access_token)
      const userRoleFromToken = payload?.user_role
      if (typeof userRoleFromToken !== 'string' || !allowedRoles.has(userRoleFromToken)) return

      setUser({ id: session.user.id, email: session.user.email })
      setUserRole(userRoleFromToken)
      setTutorId((payload?.tutor_id as number | null | undefined) ?? null)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      authEventCount += 1
      applySession(session)
    })

    void supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (authEventCount === 0) applySession(error ? null : session)
    }).catch(() => {
      if (authEventCount === 0) applySession(null)
    })

    return () => { active = false; subscription.unsubscribe() }
  }, [])

  const login = (userData: any) => {
    setUser({ id: userData.id, email: userData.email })
    setUserRole(userData.user_role)
    setTutorId(userData.tutor_id)
  }

  const logout = async () => {
    setLogoutError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setUser(null)
      setUserRole(null)
      setTutorId(null)
    } catch {
      setLogoutError('No se pudo cerrar la sesión. Verifique la conexión e intente nuevamente.')
    }
  }

  const value = { user, setUser: login, userRole, tutorId, logout, filtro, setFiltro, alumnos, setAlumnos, cuotas, setCuotas }

  return <AppContext.Provider value={value}>
    {logoutError && <div role="alert" style={{ color: '#a01026', background: '#fff1f2', padding: 12 }}>{logoutError}</div>}
    {props.children}
  </AppContext.Provider>
}

export function useApp() {
  return useContext(AppContext)
}
