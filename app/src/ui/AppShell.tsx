import type { ReactNode } from 'react'
import { useApp } from '../AppContext'
import Brand from './Brand'
import DesignIcon from './DesignIcon'

type Props = {
  active: 'students' | 'accounts'
  section?: string
  onStudents: () => void
  onAccounts?: () => void
  children: ReactNode
}

export default function AppShell({ active, section, onStudents, onAccounts, children }: Props) {
  const { user, userRole, logout } = useApp()
  const role = userRole === 'admin' ? 'Administrador' : userRole === 'secretaria' ? 'Secretaría' : 'Tutor'
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    <aside className="sidebar">
      <Brand />
      <nav className="main-nav" aria-label="Navegación principal">
        <span className="nav-caption">{userRole === 'tutor' ? 'MI FAMILIA' : 'ADMINISTRACIÓN'}</span>
        <button type="button" className={active === 'students' ? 'nav-item active' : 'nav-item'} aria-current={active === 'students' ? 'page' : undefined} onClick={onStudents}>
          <DesignIcon name={active === 'students' ? 'users' : 'usersInactive'} /><span>Alumnos</span>
        </button>
        {userRole === 'admin' && <button type="button" className={active === 'accounts' ? 'nav-item active' : 'nav-item'} aria-current={active === 'accounts' ? 'page' : undefined} onClick={onAccounts}>
          <DesignIcon name={active === 'accounts' ? 'shieldActive' : 'shield'} /><span>Cuentas de acceso</span>
        </button>}
      </nav>
    </aside>
    <div className="workspace">
      <header className="session-bar">
        <div className="mobile-brand"><Brand /></div>
        <div className="breadcrumbs"><span>{userRole === 'tutor' ? 'Mi familia' : 'Administración'}</span><DesignIcon name="breadcrumb" /><strong>{section ?? (active === 'accounts' ? 'Cuentas de acceso' : 'Alumnos')}</strong></div>
        <div className="session-user"><span className="badge">{role}</span><span className="session-email">{user?.email}</span>
          <button type="button" className="icon-button" onClick={logout} aria-label="Salir" title="Cerrar sesión"><DesignIcon name="logout" /></button>
        </div>
      </header>
      <main id="main-content" className="page-content">{children}</main>
      <footer className="app-footer"><span>Canada School · Gestión escolar</span><span>Importes expresados en ARS</span></footer>
    </div>
  </div>
}
