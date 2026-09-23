import { useState } from 'react'
import { ArrowLeft, Check, KeyRound, Phone, UserRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/page-shell'
import { Button, Card } from '../components/ui'
import { recoverParticipant, registerParticipant } from '../lib/api'
import { saveSession } from '../lib/session'

export function JoinPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'join' | 'recover'>('join')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (import.meta.env.VITE_APP_MODE !== 'supabase') {
        const session = { token: 'demo-session', participantPublicId: 'demo-participant', displayName: name || 'أحمد' }
        saveSession(session)
        if (mode === 'join') setRecoveryCode('B7K9-M2Q4')
        else navigate('/play')
        return
      }
      if (mode === 'join') {
        if (name.trim().length < 2) throw new Error('اكتب اسمك كما تحب أن يظهر على الشاشة')
        const result = await registerParticipant(name, phone)
        saveSession(result)
        setRecoveryCode(result.recoveryCode)
      } else {
        const result = await recoverParticipant(phone, code)
        saveSession(result)
        navigate('/play')
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'حدث خطأ'
      setError(message.includes('already_registered') ? 'هذا الرقم مسجل بالفعل' : message)
    } finally {
      setBusy(false)
    }
  }

  if (recoveryCode) return <PageShell className="join-page">
    <Card className="join-card success-card">
      <span className="success-icon"><Check /></span>
      <p className="eyebrow">تم تسجيلك</p>
      <h1>أهلًا {name}</h1>
      <p>احتفظ برمز الدخول إذا احتجت تفتح من متصفح آخر</p>
      <div className="recovery-code" dir="ltr">{recoveryCode}</div>
      <Button onClick={() => navigate('/play')}>ادخل الأمسية <ArrowLeft size={20} /></Button>
    </Card>
  </PageShell>

  return <PageShell className="join-page">
    <section className="join-intro">
      <p className="eyebrow">أول لحظة · أول حكاية</p>
      <h1>جاهز تكون<br /><em>أولها؟</em></h1>
      <p>سجّل مرة واحدة، وخلك على نفس الصفحة طول الأمسية.</p>
    </section>
    <Card className="join-card">
      <div className="segmented" role="tablist" aria-label="طريقة الدخول">
        <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>تسجيل جديد</button>
        <button className={mode === 'recover' ? 'active' : ''} onClick={() => setMode('recover')}>استرجاع دخولي</button>
      </div>
      <form onSubmit={submit}>
        {mode === 'join' && <label><span>الاسم</span><div className="input-wrap"><UserRound /><input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="اسمك على الشاشة" autoComplete="name" enterKeyHint="next" required /></div></label>}
        <label><span>رقم الهاتف</span><div className="input-wrap"><Phone /><input dir="ltr" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="9XXX XXXX" autoComplete="tel" enterKeyHint={mode === 'join' ? 'done' : 'next'} required /></div></label>
        {mode === 'recover' && <label><span>رمز الدخول</span><div className="input-wrap"><KeyRound /><input dir="ltr" type="text" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} enterKeyHint="done" required /></div></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'لحظة…' : mode === 'join' ? 'سجّلني' : 'استرجاع الدخول'} <ArrowLeft size={20} /></Button>
      </form>
      <p className="privacy-note">نستخدم رقمك للتسجيل فقط، ولا يظهر لأي مشارك.</p>
    </Card>
  </PageShell>
}
