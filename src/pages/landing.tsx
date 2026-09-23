import { ArrowLeft, Clock3, Eye, Palette, Sparkles, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageShell } from '../components/page-shell'
import { Wordmark } from '../components/brand'
import { readSession } from '../lib/session'

const games = [
  { number: '01', icon: Clock3, title: 'الثانية المثالية', description: 'لحظة واحدة. إحساسك بالوقت يقرر كل شيء.', className: 'perfect' },
  { number: '02', icon: Eye, title: 'أول نظرة', description: 'لمحة خاطفة، ثم تخبرنا ماذا رأيت.', className: 'look' },
  { number: '03', icon: Palette, title: 'طَيْف', description: 'الألوان تتحرك، والمفاجأة تظهر في النهاية.', className: 'taif' },
]

export function LandingPage() {
  const hasSession = Boolean(readSession())

  return <PageShell className="landing-page">
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow"><Sparkles size={17} /> بداية مختلفة لكل أمسية</p>
        <Wordmark />
        <h1>كل لحظة،<br /><em>تبدأ من هنا.</em></h1>
        <p className="landing-lead">ألعاب تفاعلية تجمع الحضور، تشعل الحماس، وتحوّل المناسبة إلى ذكرى لا تُنسى.</p>
        <div className="landing-actions">
          <Link className="button" to={hasSession ? '/play' : '/join'}>{hasSession ? 'تابع اللعب' : 'انضم إلى التجربة'} <ArrowLeft size={20} /></Link>
          <a className="landing-text-link" href="#games">اكتشف الألعاب <span aria-hidden="true">↘</span></a>
        </div>
      </div>
      <div className="landing-art" aria-hidden="true">
        <div className="landing-halo halo-one" />
        <div className="landing-halo halo-two" />
        <div className="landing-core"><img src="/awwalha-mark.svg" alt="" /></div>
        <span className="landing-orbit-label label-top">LIVE MOMENTS</span>
        <span className="landing-orbit-label label-bottom">01 / ∞</span>
      </div>
    </section>

    <section className="landing-games" id="games">
      <div className="landing-section-heading"><div><p className="eyebrow">ثلاث ألعاب · احتمالات لا تنتهي</p><h2>الليلة لها <em>إيقاعها.</em></h2></div><p>شارك من هاتفك. عِش اللحظة مع الجميع.</p></div>
      <div className="landing-game-grid">{games.map((game) => <article className={`landing-game-card ${game.className}`} key={game.number}><div className="landing-game-top"><span>{game.number}</span><game.icon size={29} strokeWidth={1.6} /></div><div><h3>{game.title}</h3><p>{game.description}</p></div></article>)}</div>
    </section>

    <section className="landing-live"><div className="landing-live-icon"><UsersRound size={27} /></div><div><p className="eyebrow">تجربة حيّة للجميع</p><h2>الشاشة الكبيرة تجمعنا. وهاتفك يخليك جزءًا من الحكاية.</h2></div><span>TOGETHER, LIVE.</span></section>

    <section className="landing-cta"><Sparkles size={25} /><h2>جاهز تبدأ الحكاية؟</h2><p>انضم الآن، وخلك قريب من كل مفاجأة.</p><Link className="button" to={hasSession ? '/play' : '/join'}>{hasSession ? 'العودة إلى اللعب' : 'ابدأ الآن'} <ArrowLeft size={20} /></Link></section>
    <footer className="landing-footer"><span>أولها © 2026</span><span>لحظات تبدأ معًا.</span></footer>
  </PageShell>
}
