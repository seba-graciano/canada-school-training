import Login from './Login'
import AdminDashboard from './AdminDashboard'
import { useApp } from './AppContext'
import { AppProvider } from './AppContext'

function AppContent() {
  const { user, setUser, userRole, tutorId, logout } = useApp()

  if (!user) {
    return <Login onLogin={setUser} />
  }

  if (!['admin', 'secretaria', 'tutor'].includes(userRole)) {
    return <div className="spin" role="alert">
      <p>No tiene un rol autorizado para acceder al panel.</p>
      <button className="btn" onClick={logout}>Salir</button>
    </div>
  }

  return <AdminDashboard key={`${user.id}:${userRole}:${tutorId ?? ''}`} />
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App
