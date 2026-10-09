import Login from './Login'
import AdminDashboard from './AdminDashboard'
import { useApp } from './AppContext'
import { AppProvider } from './AppContext'

function AppContent() {
  const { user, setUser } = useApp()

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return <AdminDashboard />
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App