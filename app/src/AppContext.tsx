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
    await supabase.auth.signOut()
    setUser(null)
    setUserRole(null)
    setTutorId(null)
  }

  const value = { user, setUser: login, userRole, tutorId, logout, filtro, setFiltro, alumnos, setAlumnos, cuotas, setCuotas }

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

export function useApp() {
  return useContext(AppContext)
}