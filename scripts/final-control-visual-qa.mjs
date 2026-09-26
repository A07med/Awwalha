// Isolated local browser QA only: every RPC/public response is a fixture.
// No requests, data writes, or game mutations against cloud infrastructure.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium, webkit } = require(process.env.STAGE_QA_PLAYWRIGHT)
const origin = 'http://127.0.0.1:4173'
const output = 'screenshots/final-control'
mkdirSync(output,{recursive:true})
const participant={token:'a'.repeat(64),participantPublicId:'p0',displayName:'مشارك'}
const user={id:'a0000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'fixture@example.test',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}
const exp=Math.floor(Date.now()/1000)+3600
const access_token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp,role:'authenticated'},'fixture'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.')
const auth={access_token,refresh_token:'fixture-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const lobby={stateVersion:1280,registrationOpen:true,phase:'lobby',currentGame:null,round:null,registeredCount:5,submittedCount:0,winners:[],taifWinners:[],tieEligiblePublicIds:[],serverPublishedAt:new Date().toISOString()}
const summary={roundId:'c0000000-0000-0000-0000-000000000002',submittedCount:5,configuredTarget:3,lockedCount:2,cutoffScore:2,tiedCount:3,remainingSeats:1,projectedWinnerCount:5,tieNeeded:true,groups:[{score:0,count:1},{score:1,count:1},{score:2,count:3}]}
let total=0
const report=[]
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]) {
 if(process.env.FINAL_QA_ENGINE && process.env.FINAL_QA_ENGINE !== engineName) continue
 const browser=await engine.launch({headless:true})
 for(const width of [390,430]) {
  for(const identity of ['none','participant','already_registered','admin','both','nonadmin','tie','closed','green','yellow','white']) {
   if(process.env.FINAL_QA_CASES && !process.env.FINAL_QA_CASES.split(',').includes(identity)) continue
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
   const isAdmin=['admin','both','tie','nonadmin'].includes(identity)
   await context.addInitScript(({identity,participant,auth})=>{
    if(['participant','both','green','yellow','white'].includes(identity)) localStorage.setItem('awwalha.participant.session.v1',JSON.stringify(participant))
    if(identity==='already_registered') localStorage.setItem('awwalha.participant.pending-registration.v1',JSON.stringify({displayName:'مسجل',phone:'+96891234567',token:'b'.repeat(64),recoveryCode:'ABCD-1234'}))
    if(['admin','both','tie','nonadmin'].includes(identity)) localStorage.setItem('sb-127-auth-token',JSON.stringify(auth))
   },{identity,participant,auth})
   const state=structuredClone(lobby)
   if(identity==='closed') state.registrationOpen=false
   if(identity==='tie') {state.phase='tie_break';state.currentGame='first_look';state.round={id:summary.roundId,gameType:'first_look',phase:'resolved',startsAt:new Date(Date.now()-30000).toISOString(),closesAt:new Date(Date.now()-10000).toISOString(),winnerTargetCount:3,seatsAvailable:3}}
   if(['green','yellow','white'].includes(identity)) {
    state.currentGame='taif';state.phase='active';state.round={id:'c0000000-0000-0000-0000-000000000003',gameType:'taif',phase:'active',startsAt:new Date(Date.now()-20000).toISOString(),closesAt:new Date(Date.now()+20000).toISOString(),revealAt:new Date(Date.now()-10000).toISOString(),winnerTargetCount:4,seatsAvailable:4}
    state.taifWinners=[{participantPublicId:identity==='green'?'p0':'p1',color:'green'},{participantPublicId:'p2',color:'green'},{participantPublicId:identity==='yellow'?'p0':'p3',color:'yellow'},{participantPublicId:'p4',color:'yellow'}]
   }
   const rpcs=[];const errors=[];const remote=[]
   const page=await context.newPage()
   page.on('pageerror',e=>errors.push(e.message))
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.hostname!=='127.0.0.1') {remote.push(url.origin);return route.abort()}
    const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
    if(url.pathname==='/api/state')return json(state)
    if(url.pathname==='/api/time')return json({serverTimeMs:Date.now()})
    if(url.pathname.startsWith('/rest/v1/rpc/')){
     const name=url.pathname.split('/').pop();rpcs.push(name)
     if(name==='is_admin')return json(identity!=='nonadmin')
     if(name==='admin_round_status')return json({submittedCount:5})
     if(name==='admin_first_look_result_summary')return json(summary)
     return json({})
    }
    if(url.pathname.startsWith('/auth/v1/'))return json(auth)
    return route.continue()
   })
   const routeName=['green','yellow','white'].includes(identity)?'/play':identity==='closed'?'/join':'/admin/login'
   await page.goto(origin+routeName)
   if(['green','yellow','white'].includes(identity)){
    await page.locator('.taif-result').waitFor()
    const style=await page.locator('.taif-result').evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {bg:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,border:s.borderTopWidth,text:e.textContent,children:e.children.length,x:r.x,y:r.y,width:r.width,height:r.height,vw:innerWidth,vh:innerHeight}})
    assert.equal(style.bg,({green:'rgb(57, 255, 20)',yellow:'rgb(255, 234, 0)',white:'rgb(255, 255, 255)'})[identity])
    assert.equal(style.image,'none');assert.equal(style.opacity,'1');assert.equal(style.border,'0px');assert.equal(style.text,'');assert.equal(style.children,0)
    assert.equal(style.x,0);assert.equal(style.y,0);assert.equal(style.width,style.vw);assert.equal(style.height,style.vh)
   }else if(identity==='closed'){
    await page.getByText('التسجيل مغلق حاليًا').waitFor();assert.equal(await page.getByRole('button',{name:/انضم الآن/}).count(),0)
   }else{
    await page.getByRole('heading',{name:'دخول الفريق'}).waitFor()
    await page.screenshot({path:output+'/'+engineName+'-'+width+'-'+identity+'-login.png',fullPage:true})
    await page.goto(origin+'/admin')
    if(!isAdmin) await page.getByRole('heading',{name:'دخول الفريق'}).waitFor()
    else if(identity==='nonadmin') await page.getByRole('alert').waitFor()
    else await page.getByRole('heading',{name:'لوحة أولها'}).waitFor()
    if(identity==='tie'){
     await page.getByRole('button',{name:'اعتماد جميع المتعادلين كفائزين'}).waitFor()
     await page.getByText('سيصبح عدد الفائزين 5 بدلاً من 3').waitFor()
    }
   }
   assert.ok(!rpcs.includes('register_participant'));assert.deepEqual(errors,[]);assert.deepEqual(remote,[])
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   await page.screenshot({path:output+'/'+engineName+'-'+width+'-'+identity+'.png',fullPage:true})
   total++;report.push({engine:engineName,width,identity,passed:true,registrationRPCs:0})
   console.log(engineName+' '+width+' '+identity+': PASS')
   await context.close()
  }
 }
 await browser.close()
}
writeFileSync(output+'/'+(process.env.FINAL_QA_ENGINE ?? 'all')+'-report.json',JSON.stringify({total,report},null,2))
console.log('MOBILE VISUAL QA: '+total+'/'+total+' PASS (LOCAL FIXTURES ONLY)')
