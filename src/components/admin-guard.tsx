import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/api'

export function AdminGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>(supabase ? 'loading' : 'allowed')
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setStatus(data.session ? 'allowed' : 'denied'))
  }, [])
  if (status === 'loading') return <main className="guard-loading" dir="rtl">جاري التحقق…</main>
  if (status === 'denied') return <Navigate to="/admin/login" replace />
  return children
}
