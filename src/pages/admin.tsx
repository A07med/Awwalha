import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Eye, Gauge, Palette, Play, RotateCcw, Settings2, ShieldCheck, TimerReset, Trash2, UsersRound } from 'lucide-react'
import { PageShell } from '../components/page-shell'
import { Button, Card, Metric, StatusPill } from '../components/ui'
import { demoLobbyState } from '../lib/demo-state'
import { usePublicState } from '../hooks/use-public-state'
import { adminClearRegistrations, adminCloseRound, adminPrepareRound, adminPrepareTaif, adminResetGames, adminRevealWinners, adminSetRegistration, adminStartTaif, adminStartTieBreak, adminResolveRound } from '../lib/api'

export function AdminPage() {
  const { state } = usePublicState({ phase: 'lobby', operator: true }, demoLobbyState)
  const [tab, setTab] = useState<'perfect' | 'look' | 'taif'>('perfect')
  const [winners, setWinners] = useState(3)
  const [target, setTarget] = useState('6.000')
  const [count, setCount] = useState(36)
  const [qr, setQr] = useState('')
  const [notice, setNotice] = useState('')
  const [taifStarting, setTaifStarting] = useState(false)
  const taifRound = state.currentGame === 'taif' ? state.round : null
  const joinUrl = typeof location === 'undefined' ? '/join' : location.origin + '/join'
  useEffect(() => { void QRCode.toDataURL(joinUrl, { width: 640, margin: 2, color: { dark: '#210b2c', light: '#00000000' } }).then(setQr) }, [joinUrl])

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(''), 2400) }
  async function act(action: () => Promise<unknown>, demoMessage: string) {
    try {
      if (import.meta.env.VITE_APP_MODE === 'supabase') await action()
      flash(demoMessage)
    } catch (reason) { flash(reason instanceof Error ? reason.message : 'تعذر تنفيذ الإجراء') }
  }
  async function prepareRound() {
    if (tab === 'taif') {
      await act(adminPrepareTaif, 'تم فتح الاستعداد لطَيْف')
      return
    }
    const value = Number(target)
    await act(() => adminPrepareRound(tab === 'perfect'
      ? { gameType: 'perfect_second', winnerCount: winners, targetMs: Math.round(value * 1000), hideTimerAfterMs: 1500 }
      : { gameType: 'first_look', winnerCount: winners, correctCount: count, visualSeed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647, visualCategory: 'leaves', displayDurationMs: 1800 }), 'تم إعداد الجولة لبداية بعد 15 ثانية')
  }
  async function startTaif() {
    if (!taifRound || taifStarting || state.submittedCount < 4) return
    setTaifStarting(true)
    try { await act(() => adminStartTaif(taifRound.id), 'بدأ طَيْف') } finally { setTaifStarting(false) }
  }
  function copyJoin() { void navigator.clipboard?.writeText(joinUrl); flash('تم نسخ رابط التسجيل') }
  function downloadQr() { const anchor = document.createElement('a'); anchor.href = qr; anchor.download = 'awwalha-join-qr.png'; anchor.click() }

  return <PageShell className="admin-page">
    <div className="admin-heading"><div><p className="eyebrow">غرفة التحكم</p><h1>لوحة أولها</h1></div><StatusPill tone="gold"><ShieldCheck size={15} /> وضع المنظم</StatusPill></div>
    <section className="system-strip"><div className="system-title"><Gauge /><div><strong>حالة النظام</strong><span>جاهز · بدون اتصالات لحظية للجمهور</span></div></div><Metric label="المسجلون" value={state.registeredCount} accent /><Metric label="اللعبة الحالية" value="الردهة" /><Metric label="المرحلة" value="جاهز" /></section>
    <div className="admin-grid">
      <Card className="control-card">
        <div className="card-heading"><div><p className="eyebrow">الجولة التالية</p><h2>{tab === 'perfect' ? 'الثانية المثالية' : tab === 'look' ? 'أول نظرة' : 'طَيْف'}</h2></div><div className="game-tabs"><button aria-label="الثانية المثالية" className={tab === 'perfect' ? 'active' : ''} onClick={() => setTab('perfect')}><TimerReset /></button><button aria-label="أول نظرة" className={tab === 'look' ? 'active' : ''} onClick={() => setTab('look')}><Eye /></button><button aria-label="طيف" className={tab === 'taif' ? 'active' : ''} onClick={() => setTab('taif')}><Palette /></button></div></div>
        {tab === 'taif' ? <div className="taif-admin-flow">
          <div className="taif-fixed-winners"><span>الفائزون ثابتون</span><strong>٤</strong><small>٢ أخضر فاتح · ٢ أصفر فاتح</small></div>
          {!taifRound ? <Button className="prepare-button" onClick={prepareRound}>فتح الاستعداد <Play size={18} /></Button>
          : taifRound.phase === 'preparing' ? <><div className="taif-ready-count"><strong>{state.submittedCount}</strong><span>مستعد</span></div><Button className="prepare-button" disabled={state.submittedCount < 4 || taifStarting} onClick={() => void startTaif()}>ابدأ طَيْف <Play size={18} /></Button></>
          : <div className="schedule-callout"><Settings2 /><div><strong>طَيْف جارٍ الآن</strong><span>تم قفل قائمة المستعدين واختيار أربعة فائزين.</span></div></div>}
        </div> : <>
          <div className="control-form">
            <label><span>عدد الفائزين</span><div className="stepper"><button onClick={() => setWinners(Math.max(1, winners - 1))}>−</button><strong>{winners}</strong><button onClick={() => setWinners(Math.min(6, winners + 1))}>+</button></div></label>
            {tab === 'perfect' ? <><label><span>الوقت المستهدف</span><div className="unit-input"><input dir="ltr" value={target} onChange={(event) => setTarget(event.target.value)} /><b>ث</b></div></label><label><span>إخفاء العداد بعد</span><select defaultValue="1500"><option value="1500">1.5 ثانية</option><option value="1800">1.8 ثانية</option><option value="2000">2.0 ثانية</option></select></label></>
            : <><label><span>فئة العناصر</span><select defaultValue="leaves"><option value="seeds">بذور</option><option value="leaves">أوراق</option><option value="fish">أسماك</option><option value="bubbles">فقاعات</option><option value="random">عشوائي</option></select></label><label><span>عدد العناصر</span><input type="number" min="20" max="60" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label><span>مدة العرض</span><select defaultValue="1800"><option value="1500">1.5 ثانية</option><option value="1800">1.8 ثانية</option><option value="2000">2.0 ثانية</option></select></label></>}
          </div>
          <div className="schedule-callout"><Settings2 /><div><strong>بداية مجدولة بعد 15 ثانية</strong><span>يصل التوقيت للجمهور مسبقًا ويبدأ محليًا بدقة.</span></div></div>
          <Button className="prepare-button" onClick={prepareRound}>إعداد الجولة <Play size={18} /></Button>
          {state.round && state.currentGame !== 'taif' && <div className="round-actions"><button onClick={() => void act(() => adminCloseRound(state.round!.id), 'تم إغلاق الجولة')}>إغلاق</button><button onClick={() => void act(() => adminResolveRound(state.round!.id), 'تم حساب النتيجة')}>حساب النتيجة</button><button onClick={() => void act(() => adminStartTieBreak(state.round!.id), 'تم إعداد الجولة الفاصلة')}>جولة فاصلة</button><button className="reveal" onClick={() => void act(() => adminRevealWinners(state.round!.id), 'تم كشف الفائزين')}>كشف الفائزين</button></div>}
        </>}
      </Card>
      <div className="admin-side">
        <Card className="registration-card"><div className="card-heading"><div><p className="eyebrow">التسجيل</p><h2>رابط الدخول</h2></div><StatusPill>{state.registrationOpen ? 'مفتوح' : 'مغلق'}</StatusPill></div><div className="qr-wrap">{qr && <img src={qr} alt="رمز QR للتسجيل" />}</div><div className="qr-actions"><button onClick={copyJoin}><Copy /> نسخ الرابط</button><button onClick={downloadQr}><Download /> تحميل QR</button><button onClick={() => void act(() => adminSetRegistration(true), 'تم فتح التسجيل')}>فتح التسجيل</button><button onClick={() => void act(() => adminSetRegistration(false), 'تم إغلاق التسجيل')}>إغلاق التسجيل</button></div></Card>
        <Card className="safe-actions"><h3>إدارة الأمسية</h3><button onClick={() => void act(adminResetGames, 'تمت إعادة الألعاب إلى الردهة')}><RotateCcw /> إعادة ضبط الألعاب <small>يحفظ التسجيلات</small></button><button className="danger" onClick={() => window.confirm('سيتم حذف جميع التسجيلات والجلسات. هل أنت متأكد؟') && void act(adminClearRegistrations, 'تم حذف جميع التسجيلات')}><Trash2 /> حذف جميع التسجيلات <small>تأكيد إلزامي</small></button></Card>
      </div>
    </div>
    <section className="operator-note"><UsersRound /><span>عدّاد الإرساليات يظهر للمشغّلين فقط ويُحدّث بطلب واحد غير متداخل.</span></section>
    {notice && <div className="toast">{notice}</div>}
  </PageShell>
}
