import '../src/index.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider, useApp } from '../src/AppContext'
import AdminDashboard from '../src/AdminDashboard'
import Login from '../src/Login'
import { supabase } from '../src/supabase'

// Keep real Auth/storage/HTTP behavior while controlling Realtime delivery locally.
const channels = new Map<object, () => void>()
const controls: any = { supabase, refresh: () => channels.forEach(callback => callback()) }
;(window as any).audit = controls
const rpc = supabase.rpc.bind(supabase)
controls.completed = []
supabase.rpc = ((...args: Parameters<typeof supabase.rpc>) => {
  const index = controls.completed.length
  controls.completed.push(false)
  const query = rpc(...args) as any
  const then = query.then.bind(query)
  query.then = (onfulfilled: unknown, onrejected: unknown) => then(onfulfilled, onrejected)
    .finally(() => { controls.completed[index] = true })
  return query
}) as typeof supabase.rpc
supabase.channel = (() => {
  const channel = {
    on(_event: string, _filter: unknown, callback: () => void) {
      channels.set(channel, callback)
      return channel
    },
    subscribe() { return channel },
  }
  return channel
}) as typeof supabase.channel
supabase.removeChannel = (async channel => {
  channels.delete(channel)
  return 'ok'
}) as typeof supabase.removeChannel

export function Screen() {
  const context = useApp()
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    controls.context = context
    controls.showDashboard = setVisible
  }, [context])
  return context.user
    ? visible && <AdminDashboard />
    : <Login onLogin={context.setUser} />
}

const root = createRoot(document.getElementById('root')!)
const application = <AppProvider><Screen /></AppProvider>
root.render(new URLSearchParams(location.search).has('strict')
  ? <StrictMode>{application}</StrictMode>
  : application)
