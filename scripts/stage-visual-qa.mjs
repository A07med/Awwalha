// Isolated projector rendering with LOCAL HTTP fixtures only. No cloud mutation,
// no production fixture controls, no load. Run with the real-mode local Vite
// server and local Supabase URL; all state/detail responses are HTTP fixtures.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch {
  const bundled = process.env.STAGE_QA_PLAYWRIGHT
  if (!bundled) throw new Error('Install Playwright separately or set STAGE_QA_PLAYWRIGHT to the bundled module path')
  playwright = require(bundled)
}
const { chromium } = playwright
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const out = 'screenshots/projector'
mkdirSync(out, { recursive: true })
const cases = [
  ['perfect_second','idle'], ['perfect_second','countdown'], ['perfect_second','visible'], ['perfect_second','hidden'], ['perfect_second','winners'],
  ['first_look','idle'], ['first_look','countdown'], ['first_look','visual'], ['first_look','question'], ['first_look','winners'],
  ['taif','preparing'], ['taif','active'], ['taif','final'],
]
const report = []
for (const size of [[1920,1080],[1366,768],[2560,1440]]) for (const [game, scene] of cases.filter(([,scene]) => !process.env.STAGE_QA_SCENE || scene === process.env.STAGE_QA_SCENE)) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } })
  const errors = []; let detailCalls = 0
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    assert.ok(['127.0.0.1'].includes(url.hostname), 'QA must not call cloud')
    if (url.pathname === '/api/time') return route.fulfill({ json: { epochMs: Date.now() } })
    if (url.pathname.endsWith('/rpc/admin_round_detail')) { detailCalls++; return route.fulfill({ json: { correctCount: 36, visualSeed: 90731, visualCategory: 'leaves', displayDurationMs: 1800 } }) }
    if (url.pathname === '/api/state') {
      const elapsed = { countdown: -3000, visible: 300, hidden: 2200, visual: 0, question: 3000, active: 500, final: 7000, preparing: -604000000 }[scene] ?? 0
      const startsAt = Date.now() - elapsed
      const phase = scene === 'winners' || scene === 'final' ? 'revealed' : scene === 'preparing' ? 'preparing' : 'active'
      const winners = Array.from({length:6}, (_,i) => ({participantPublicId:'fixture-'+i,displayName:['أحمد سالم','مريم علي','سارة محمد','خالد حسن','نور عبدالله','عمر سعيد'][i],score:2,signedDeltaMs:i % 2 ? -2 : 2,guess:36}))
      return route.fulfill({ json: { stateVersion: 1, registrationOpen: false, currentGame: scene === 'idle' ? null : game, phase, registeredCount: 750, submittedCount: 512,
        round: scene === 'idle' ? null : { id:'33333333-3333-4333-8333-333333333333',gameType:game,phase,startsAt:new Date(startsAt).toISOString(),closesAt:new Date(startsAt+12000).toISOString(),revealAt:new Date(startsAt+6000).toISOString(),targetMs:6000,hideTimerAfterMs:1500,displayDurationMs:1800,winnerTargetCount:6,seatsAvailable:6 },
        winners:scene === 'winners' ? winners : [],taifWinners:scene === 'final' ? Array.from({length:4},(_,i)=>({participantPublicId:'fixture-'+i,color:i<2?'green':'yellow'})):[],tieEligiblePublicIds:[],serverPublishedAt:new Date().toISOString() } })
    }
    return route.continue()
  })
  await page.goto('http://127.0.0.1:4173/scripts/stage-qa.html?game='+game)
  await page.locator('.projector, .taif-stage-active, .projector-final').waitFor()
  if (scene === 'idle') await page.locator('[data-stage-phase="idle"]').waitFor()
  else if (scene === 'visual') await page.locator('.visual-item').first().waitFor()
  else if (scene === 'countdown') await page.locator('.projector-countdown').waitFor()
  else if (scene === 'winners') await page.locator('.winner-card').first().waitFor()
  else if (scene === 'preparing') await page.locator('.projector-ready-count').waitFor()
  else if (scene === 'final') await page.locator('.projector-final').waitFor()
  else if (scene === 'active' && game === 'taif') await page.locator('.taif-stage-active').waitFor()
  else if (game === 'perfect_second' && scene !== 'idle') await page.locator('.projector-timer').waitFor()
  else if (scene === 'question') await page.locator('.projector-question').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const layout = await page.evaluate(() => {
    const r = el => { const b=el.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom} }
    const content=document.querySelector('.projector-canvas > *, .projector-final h1')
    const rect=content ? r(content) : null
    const icons=[...document.querySelectorAll('.visual-item')].map(r)
    let overlaps=0
    for(let i=0;i<icons.length;i++)for(let j=i+1;j<icons.length;j++) if(icons[i].x<icons[j].right&&icons[i].right>icons[j].x&&icons[i].y<icons[j].bottom&&icons[i].bottom>icons[j].y)overlaps++
    return {rect,icons:icons.length,overlaps,scroll:document.documentElement.scrollHeight>innerHeight,clipped:[...document.querySelectorAll('.projector-canvas h1,.projector-canvas p,.projector-target,.projector-timer,.winner-card,.projector-header,.projector-rail,.projector-final h1')].map(r).some(b=>b.x<0||b.y<0||b.right>innerWidth+1||b.bottom>innerHeight+1),centerDelta:rect?Math.abs(rect.x+rect.width/2-innerWidth/2):0}
  })
  assert.equal(layout.scroll,false);assert.equal(layout.clipped,false);assert.ok(layout.centerDelta<2);assert.equal(layout.overlaps,0)
  if(scene==='visual')assert.equal(layout.icons,36)
  assert.equal(errors.length,0)
  assert.equal(detailCalls,game==='first_look'&&scene!=='idle'?1:0)
  const file=out+'/'+size.join('x')+'-'+game+'-'+scene+'.png'
  await page.screenshot({path:file})
  report.push({size,game,scene,...layout,detailCalls,errors,file})
  console.log('PASS',size.join('x'),game,scene)
  await page.close()
}
writeFileSync(out+'/report'+(process.env.STAGE_QA_SCENE ? '-'+process.env.STAGE_QA_SCENE : '')+'.json',JSON.stringify(report,null,2))
await browser.close()
console.log('Projector QA:',report.length,'screens PASS')
