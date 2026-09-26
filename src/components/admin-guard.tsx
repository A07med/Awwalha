import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase, verifyAdminAccess } from '../lib/api'

export function AdminGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'unauthenticated' | 'forbidden' | 'failed'>(supabase ? 'loading' : 'allowed')
  useEffect(() => {
    if (!supabase) return
    let stopped = false
    let generation = 0
    const verify = async () => {
      const current = ++generation
      if (!stopped) setStatus('loading')
      try {
        const next = await verifyAdminAccess()
        if (!stopped && current === generation) setStatus(next)
      } catch { if (!stopped && current === generation) setStatus('failed') }
    }
    void verify()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION') return
      // Do not await a Supabase call inside the auth callback's lock.
      generation++
      setStatus('loading')
      queueMicrotask(() => { if (!stopped) void verify() })
    })
    return () => { stopped = true; generation++; data.subscription.unsubscribe() }
  }, [])
  if (status === 'loading') return <main className="guard-loading" dir="rtl">جاري التحقق…</main>
  if (status === 'unauthenticated') return <Navigate to="/admin/login" replace />
  if (status === 'forbidden' || status === 'failed') return <main className="guard-loading" dir="rtl"><p role="alert">{status === 'forbidden' ? 'حسابك مسجّل الدخول، لكنه غير مخوّل لإدارة الأمسية. تواصل مع المنظم.' : 'تعذر التحقق من صلاحية الإدارة. أعد تسجيل الدخول وحاول مجددًا.'}</p><Link to="/admin/login">دخول الفريق</Link></main>
  return children
}
