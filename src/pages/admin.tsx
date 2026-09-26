import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Eye, Gauge, Play, RotateCcw, Settings2, ShieldCheck, TimerReset, Trash2, UsersRound } from 'lucide-react'
import { PageShell } from '../components/page-shell'
import { Button, Card, Metric, StatusPill } from '../components/ui'
import { TaifMark } from '../components/taif-mark'
import { demoLobbyState } from '../lib/demo-state'
import { usePublicState } from '../hooks/use-public-state'
import { useOperatorRoundStatus } from '../hooks/use-operator-round-status'
import { adminErrorMessage, adminRoundActions, confirmedAdminState, type ConfirmedAdminTransition } from '../lib/admin-actions'
import { adminClearRegistrations, adminCloseRound, adminPrepareRound, adminPrepareTaif, adminResetGames, adminRevealWinners, adminSetRegistration, adminStartTaif, adminStartTieBreak, adminResolveRound } from '../lib/api'

export function AdminPage() {
  const { state, refresh, setState } = usePublicState({ phase: 'lobby', operator: true }, demoLobbyState)
  const operatorStatus = useOperatorRoundStatus(state.round?.id ?? null, refresh)
  const submittedCount = operatorStatus.submittedCount ?? (operatorStatus.error ? 0 : state.submittedCount)
  const [closedRoundId, setClosedRoundId] = useState<string | null>(null)
  const [confirmedTransition, setConfirmedTransition] = useState<ConfirmedAdminTransition | null>(null)
  const operatorState = confirmedAdminState(state, confirmedTransition)
  const actions = adminRoundActions(operatorState, closedRoundId === state.round?.id)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
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
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (import.meta.env.VITE_APP_MODE === 'supabase') await action()
      flash(demoMessage)
    } catch (reason) { flash(adminErrorMessage(reason)) }
    finally { await refresh(); busyRef.current = false; setBusy(false) }
  }
  async function transition(kind: 'close' | 'resolve' | 'tie' | 'reveal') {
    if (!state.round || !actions[kind] || busyRef.current) return
    const roundId = state.round.id
    await act(async () => {
      if (kind === 'tie') return adminStartTieBreak(roundId)
      const result = kind === 'close' ? await adminCloseRound(roundId)
        : kind === 'resolve' ? await adminResolveRound(roundId) : await adminRevealWinners(roundId)
      const resolution = result as { tiedCount?: number; remainingSeats?: number }
      const phase = kind === 'close' ? 'closed' : kind === 'reveal' ? 'revealed' : 'resolved'
      if (kind === 'close') setClosedRoundId(roundId)
      const tieNeeded = kind === 'resolve' && (resolution.tiedCount ?? 0) > (resolution.remainingSeats ?? 0) && (resolution.remainingSeats ?? 0) > 0
      const closesAt = kind === 'close' ? new Date(Math.min(Date.now(), Date.parse(operatorState.round!.closesAt ?? new Date().toISOString()))).toISOString() : operatorState.round!.closesAt
      setConfirmedTransition({ roundId, phase, publicPhase: tieNeeded ? 'tie_break' : phase, closesAt })
      // Confirmed backend transitions prevent repeat clicks while ISR catches up.
      setState((current) => current.round?.id === roundId ? { ...current,
        phase: tieNeeded ? 'tie_break' : phase,
        round: { ...current.round, phase, closesAt },
      } : current)
      return result
    }, kind === 'close' ? 'تم إغلاق الجولة' : kind === 'resolve' ? 'تم حساب النتيجة' : kind === 'tie' ? 'تم إعداد الجولة الفاصلة' : 'تم كشف الفائزين')
  }
  async function prepareRound() {
    if (tab === 'taif') {
      await act(adminPrepareTaif, 'تم فتح الاستعداد لوَهَج')
      return
    }
    const value = Number(target)
    await act(() => adminPrepareRound(tab === 'perfect'
      ? { gameType: 'perfect_second', winnerCount: winners, targetMs: Math.round(value * 1000), hideTimerAfterMs: 1500 }
      : { gameType: 'first_look', winnerCount: winners, correctCount: count, visualSeed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647, visualCategory: 'leaves', displayDurationMs: 1800 }), 'تم إعداد الجولة لبداية بعد 15 ثانية')
  }
  async function startTaif() {
    if (!taifRound || taifStarting || submittedCount < 4) return
    setTaifStarting(true)
    try { await act(() => adminStartTaif(taifRound.id), 'بدأ وَهَج') } finally { setTaifStarting(false) }
  }
  function copyJoin() { void navigator.clipboard?.writeText(joinUrl); flash('تم نسخ رابط التسجيل') }
  function downloadQr() { const anchor = document.createElement('a'); anchor.href = qr; anchor.download = 'awwalha-join-qr.png'; anchor.click() }

  return <PageShell className="admin-page">
    <div className="admin-heading"><div><p className="eyebrow">غرفة التحكم</p><h1>لوحة أولها</h1></div><StatusPill tone="gold"><ShieldCheck size={15} /> وضع المنظم</StatusPill></div>
    <section className="system-strip"><div className="system-title"><Gauge /><div><strong>حالة النظام</strong><span>جاهز · بدون اتصالات لحظية للجمهور</span></div></div><Metric label="المسجلون" value={state.registeredCount} accent /><Metric label="اللعبة الحالية" value="الردهة" /><Metric label="المرحلة" value="جاهز" /></section>
    <div className="admin-grid">
      <Card className="control-card">
        <div className="card-heading"><div><p className="eyebrow">الجولة التالية</p><h2>{tab === 'perfect' ? 'الثانية المثالية' : tab === 'look' ? 'أول نظرة' : 'وَهَج'}</h2></div></div>
        <div className="game-tabs" role="group" aria-label="اختيار اللعبة">
          <button aria-label="الثانية المثالية" aria-pressed={tab === 'perfect'} className={tab === 'perfect' ? 'active' : ''} onClick={() => setTab('perfect')}><TimerReset /><strong>الثانية المثالية</strong><small>التوقيت هو كل شيء</small></button>
          <button aria-label="أول نظرة" aria-pressed={tab === 'look'} className={tab === 'look' ? 'active' : ''} onClick={() => setTab('look')}><Eye /><strong>أول نظرة</strong><small>لاحظ… واكتشف</small></button>
          <button aria-label="وَهَج" aria-pressed={tab === 'taif'} className={tab === 'taif' ? 'active' : ''} onClick={() => setTab('taif')}><TaifMark /><strong>وَهَج</strong><small>دع اللون يختار</small></button>
        </div>
        {tab === 'taif' ? <div className="taif-admin-flow">
          <div className="taif-fixed-winners"><span>الفائزون ثابتون</span><strong>٤</strong><small>٢ أخضر فاتح · ٢ أصفر فاتح</small></div>
          {!taifRound ? <Button className="prepare-button" disabled={busy} onClick={prepareRound}>فتح الاستعداد <Play size={18} /></Button>
          : taifRound.phase === 'preparing' ? <><div className="taif-ready-count"><strong>{submittedCount}</strong><span>مستعد</span></div><Button className="prepare-button" disabled={submittedCount < 4 || taifStarting || busy} onClick={() => void startTaif()}>ابدأ وَهَج <Play size={18} /></Button></>
          : <div className="schedule-callout"><Settings2 /><div><strong>وَهَج جارٍ الآن</strong><span>تم قفل قائمة المستعدين واختيار أربعة فائزين.</span></div></div>}
        </div> : <>
          <div className="control-form">
            <label><span>عدد الفائزين</span><div className="stepper"><button onClick={() => setWinners(Math.max(1, winners - 1))}>−</button><strong>{winners}</strong><button onClick={() => setWinners(Math.min(6, winners + 1))}>+</button></div></label>
            {tab === 'perfect' ? <><label><span>الوقت المستهدف</span><div className="unit-input"><input dir="ltr" value={target} onChange={(event) => setTarget(event.target.value)} /><b>ث</b></div></label><label><span>إخفاء العداد بعد</span><select defaultValue="1500"><option value="1500">1.5 ثانية</option><option value="1800">1.8 ثانية</option><option value="2000">2.0 ثانية</option></select></label></>
            : <><label><span>فئة العناصر</span><select defaultValue="leaves"><option value="seeds">بذور</option><option value="leaves">أوراق</option><option value="fish">أسماك</option><option value="bubbles">فقاعات</option><option value="random">عشوائي</option></select></label><label><span>عدد العناصر</span><input type="number" min="20" max="60" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label><span>مدة العرض</span><select defaultValue="1800"><option value="1500">1.5 ثانية</option><option value="1800">1.8 ثانية</option><option value="2000">2.0 ثانية</option></select></label></>}
          </div>
          <div className="schedule-callout"><Settings2 /><div><strong>بداية مجدولة بعد 15 ثانية</strong><span>يصل التوقيت للجمهور مسبقًا ويبدأ محليًا بدقة.</span></div></div>
          <Button className="prepare-button" disabled={busy} onClick={prepareRound}>إعداد الجولة <Play size={18} /></Button>
          {state.round && state.currentGame !== 'taif' && <div className="round-actions"><span>الإرساليات: {submittedCount}</span><button disabled={busy || !actions.close} onClick={() => void transition('close')}>إغلاق</button><button disabled={busy || !actions.resolve} onClick={() => void transition('resolve')}>حساب النتيجة</button>{actions.tie && <button disabled={busy} onClick={() => void transition('tie')}>جولة فاصلة</button>}<button className="reveal" disabled={busy || !actions.reveal} onClick={() => void transition('reveal')}>كشف الفائزين</button></div>}
        </>}
      </Card>
      <div className="admin-side">
        <Card className="registration-card"><div className="card-heading"><div><p className="eyebrow">التسجيل</p><h2>رابط الدخول</h2></div><StatusPill>{state.registrationOpen ? 'مفتوح' : 'مغلق'}</StatusPill></div><div className="qr-wrap">{qr && <img src={qr} alt="رمز QR للتسجيل" />}</div><div className="qr-actions"><button onClick={copyJoin}><Copy /> نسخ الرابط</button><button onClick={downloadQr}><Download /> تحميل QR</button><button onClick={() => void act(() => adminSetRegistration(true), 'تم فتح التسجيل')}>فتح التسجيل</button><button onClick={() => void act(() => adminSetRegistration(false), 'تم إغلاق التسجيل')}>إغلاق التسجيل</button></div></Card>
        <Card className="safe-actions"><h3>إدارة الأمسية</h3><button onClick={() => void act(adminResetGames, 'تمت إعادة الألعاب إلى الردهة')}><RotateCcw /> إعادة ضبط الألعاب <small>يحفظ التسجيلات</small></button><button className="danger" onClick={() => window.confirm('سيتم حذف جميع التسجيلات والجلسات. هل أنت متأكد؟') && void act(adminClearRegistrations, 'تم حذف جميع التسجيلات')}><Trash2 /> حذف جميع التسجيلات <small>تأكيد إلزامي</small></button></Card>
      </div>
    </div>
    <section className="operator-note"><UsersRound /><span>{operatorStatus.error === 'invalid_round' ? 'الجولة المعروضة لم تعد متاحة؛ ننتظر تحديث حالة الأمسية.' : operatorStatus.error === 'authorization' ? 'حسابك غير مخوّل للإدارة؛ أُوقف تحديث العدّاد.' : operatorStatus.error === 'reauthenticate' ? 'انتهت جلسة الإدارة؛ أعد تسجيل الدخول.' : operatorStatus.error ? 'تعذر تحديث العدّاد؛ أُوقفت المحاولات المتكررة. حدّث الصفحة للمحاولة مجددًا.' : 'عدّاد الإرساليات يظهر للمشغّلين فقط ويُحدّث بطلب واحد غير متداخل.'}</span>{operatorStatus.error === 'reauthenticate' && <a href="/admin/login">دخول الفريق</a>}</section>
    {notice && <div className="toast">{notice}</div>}
  </PageShell>
}
