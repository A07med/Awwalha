import { useState } from 'react'
import { LockKeyhole, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/page-shell'
import { Button, Card } from '../components/ui'
import { supabase } from '../lib/api'

export function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function login(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) { navigate('/admin'); return }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) setError('تعذر تسجيل الدخول')
    else navigate('/admin')
  }
  return <PageShell className="admin-login-page"><Card className="admin-login-card"><span className="login-lock"><LockKeyhole /></span><p className="eyebrow">لوحة المنظم</p><h1>دخول الفريق</h1><form onSubmit={login}><label><span>البريد الإلكتروني</span><input dir="ltr" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label><span>كلمة المرور</span><input dir="ltr" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<Button type="submit">دخول <LogIn size={18} /></Button></form></Card></PageShell>
}
