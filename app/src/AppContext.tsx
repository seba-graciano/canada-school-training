import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AppContext = createContext<any>(null)

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const userRoleFromToken = payload.user_role
        const tutorIdFromToken = payload.tutor_id

        if (userRoleFromToken) {
          setUser({ id: session.user.id, email: session.user.email })
          setUserRole(userRoleFromToken)
          setTutorId(tutorIdFromToken)
        }
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const userRoleFromToken = payload.user_role
        const tutorIdFromToken = payload.tutor_id

        if (userRoleFromToken) {
          setUser({ id: session.user.id, email: session.user.email })
          setUserRole(userRoleFromToken)
          setTutorId(tutorIdFromToken)
        }
      } else {
        setUser(null)
        setUserRole(null)
        setTutorId(null)
      }
    })

    return () => subscription.unsubscribe()
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
