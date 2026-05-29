import { useCallback, useEffect, useMemo, useState } from 'react'
import './styles.css'

const LS = { groq:'md_groq_key', finnhub:'md_finnhub_key', model:'md_model' }
const WATCHLIST = ['EUR/USD','GBP/USD','XAU/USD','DXY','NAS100','SPX500','US10Y','BTC/USD']
const ASSETS = [
  { id:'ALL', label:'ALL', emoji:'🌐', queries:['forex','federal reserve','ecb','inflation','jobs','dollar','gold','treasury'] },
  { id:'EURUSD', label:'EUR/USD', emoji:'🇪🇺', queries:['euro','ecb','eurusd','eurozone','dollar'] },
  { id:'GBPUSD', label:'GBP/USD', emoji:'🇬🇧', queries:['pound','boe','gbpusd','uk inflation','dollar'] },
  { id:'XAUUSD', label:'XAU/USD', emoji:'🥇', queries:['gold','xau','treasury yields','real yields','dollar'] },
  { id:'INDICES', label:'INDEX', emoji:'🇺🇸', queries:['nasdaq','sp500','risk sentiment','stocks','federal reserve'] },
]
const IMPACT = { high:'#ff4d6d', medium:'#f59e0b', low:'#64748b' }
const nowIsoDate = (offset=0)=>{ const d=new Date(); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10) }
const timeFmt = d => new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(d))
const dateFmt = d => new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',timeZone:'Europe/Berlin'}).format(new Date(d))
const safeJson = txt => { try { return JSON.parse(txt) } catch { const a=txt.indexOf('{'), b=txt.lastIndexOf('}'); if(a>=0&&b>a){ try{return JSON.parse(txt.slice(a,b+1))}catch{}} return null } }
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n))

function demoNews(){
  return [
    {id:'n1', datetime:Date.now()/1000, source:'Macro Desk', headline:'Dollar holds firm before US inflation data as yields stay elevated', summary:'Markets wait for CPI and Fed speakers. EUR/USD remains sensitive to dollar repricing.'},
    {id:'n2', datetime:Date.now()/1000-1800, source:'Macro Desk', headline:'Gold consolidates as traders watch real yields and risk sentiment', summary:'XAU/USD may stay bid if yields fall or risk-off flow returns.'},
    {id:'n3', datetime:Date.now()/1000-3600, source:'Macro Desk', headline:'European currencies trade cautiously before ECB commentary', summary:'EUR and GBP need clean catalyst; range conditions remain possible until US session.'},
    {id:'n4', datetime:Date.now()/1000-5400, source:'Macro Desk', headline:'US equity futures mixed ahead of key macro calendar', summary:'Indices are vulnerable to high-impact data and Fed repricing.'},
  ]
}
function demoCalendar(){
  const today=nowIsoDate(0)
  return [
    {id:'c1', date:`${today} 08:00:00`, country:'EUR', event:'German CPI m/m', impact:'medium', actual:'', estimate:'0.2%', previous:'0.1%'},
    {id:'c2', date:`${today} 11:00:00`, country:'EUR', event:'ECB President Speech', impact:'high', actual:'', estimate:'', previous:''},
    {id:'c3', date:`${today} 14:30:00`, country:'USD', event:'Core PCE Price Index', impact:'high', actual:'', estimate:'0.3%', previous:'0.2%'},
    {id:'c4', date:`${today} 16:00:00`, country:'USD', event:'Consumer Confidence', impact:'medium', actual:'', estimate:'101.0', previous:'99.8'},
  ]
}

async function groqAnalyze(key, model, payload){
  if(!key) throw new Error('Нет Groq key')
  const prompt = `Ты профессиональный макро-аналитик для интрадей трейдера ICT/SMC. Я дам новости и календарь. Не выдумывай факты. Верни только JSON на русском языке:
{"macroBias":"RISK_ON/RISK_OFF/NEUTRAL","dollarBias":"BULLISH/BEARISH/NEUTRAL","primaryAsset":"EUR/USD или GBP/USD или XAU/USD или INDEX","confidence":0-100,"headline":"одна строка главной идеи","drivers":["3 коротких причины"],"assetBias":[{"asset":"EUR/USD","bias":"LONG/SHORT/WAIT","reason":"коротко","trigger":"что должно случиться","risk":"что отменяет"}],"riskEvents":[{"time":"HH:MM","event":"название","impact":"HIGH/MEDIUM/LOW","meaning":"как трактовать для рынка"}],"executionPlan":{"beforeNews":"что делать до новости","afterNews":"что делать после новости","avoid":"когда не торговать"},"ictNarrative":"5-7 строк четкого плана без воды"}`
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
    body:JSON.stringify({model:model||'llama-3.1-8b-instant',temperature:.25,max_tokens:1500,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(payload).slice(0,12000)}]})
  })
  const d=await res.json(); if(d.error) throw new Error(d.error.message)
  const text=d.choices?.[0]?.message?.content||''; const j=safeJson(text); if(!j) throw new Error('AI вернул не JSON')
  return j
}
async function fetchFinnhubNews(key){
  if(!key) return demoNews()
  const cats=['forex','general']
  const results=[]
  for(const cat of cats){
    try{ const r=await fetch(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`); const d=await r.json(); if(Array.isArray(d)) results.push(...d.slice(0,20)) }catch{}
  }
  const map=new Map(); results.forEach(n=>{ if(n.headline&&!map.has(n.headline)) map.set(n.headline,n) })
  return [...map.values()].slice(0,30)
}
async function fetchFinnhubCalendar(key){
  if(!key) return demoCalendar()
  try{
    const r=await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${nowIsoDate(-1)}&to=${nowIsoDate(2)}&token=${key}`)
    const d=await r.json(); const arr=d.economicCalendar||d.calendar||[]
    if(Array.isArray(arr)&&arr.length) return arr.slice(0,80).map((e,i)=>({id:i,date:e.time||e.date||e.datetime,country:e.country||e.region||'',event:e.event||e.name||e.indicator||'',impact:(e.impact||e.importance||'').toString().toLowerCase(),actual:e.actual,estimate:e.estimate||e.forecast,previous:e.prev||e.previous}))
  }catch{}
  return demoCalendar()
}
function localMacro(news, calendar, asset='ALL'){
  const txt=[...news.map(n=>`${n.headline} ${n.summary||''}`),...calendar.map(c=>`${c.country} ${c.event}`)].join(' ').toLowerCase()
  let dollar=0, risk=0, gold=0
  ;['fed','rate','yield','inflation','cpi','pce','dollar','hawkish'].forEach(w=>{ if(txt.includes(w)) dollar+=1 })
  ;['risk','stocks','nasdaq','sp500','confidence','growth'].forEach(w=>{ if(txt.includes(w)) risk+=1 })
  ;['gold','xau','war','geopolitical','safe haven'].forEach(w=>{ if(txt.includes(w)) gold+=1 })
  const high=calendar.filter(c=>(c.impact||'').includes('high')||/cpi|pce|fed|ecb|nfp|payroll|rate|speech/i.test(c.event||''))
  const dollarBias=dollar>2?'BULLISH':txt.includes('weak dollar')?'BEARISH':'NEUTRAL'
  const macroBias=risk>3&&dollarBias!=='BULLISH'?'RISK_ON':high.length?'EVENT_RISK':'NEUTRAL'
  const confidence=clamp(52+high.length*7+dollar*3,50,84)
  return {
    macroBias, dollarBias, confidence,
    headline: high.length ? `Сегодня главный риск — ${high[0].event}` : 'День без сильного подтверждённого макро-драйвера',
    drivers:[high.length?`High impact событий: ${high.length}`:'Календарь спокойный', dollarBias==='BULLISH'?'USD получает поддержку от темы ставок/доходностей':'USD без явного преимущества', gold?'Золото чувствительно к real yields и risk-off':'Risk sentiment важнее одиночных заголовков'],
    assetBias:[
      {asset:'EUR/USD',bias:dollarBias==='BULLISH'?'SHORT':'WAIT',reason:'пара зависит от USD repricing и ECB/US data',trigger:'импульс после USD новости + закрепление',risk:'ложный пробой и возврат в range'},
      {asset:'GBP/USD',bias:dollarBias==='BULLISH'?'SHORT':'WAIT',reason:'GBP часто повторяет EUR при USD-драйвере',trigger:'синхронное движение EUR/GBP против USD',risk:'дивергенция GBP и EUR'},
      {asset:'XAU/USD',bias:dollarBias==='BULLISH'?'SHORT':'WAIT/LONG',reason:'золото реагирует на real yields и risk-off',trigger:'доходности вниз или risk-off',risk:'рост доходностей США'},
      {asset:'INDEX',bias:macroBias==='RISK_ON'?'LONG':high.length?'WAIT':'WAIT',reason:'индексы зависят от реакции на календарь',trigger:'данные мягче ожиданий + USD/yields вниз',risk:'hawkish surprise'}
    ],
    riskEvents: high.slice(0,6).map(c=>({time:timeFmt(c.date),event:c.event,impact:'HIGH',meaning:'До публикации не лезть в середине диапазона; после ждать sweep/impulse/закрепление'})),
    executionPlan:{beforeNews:'До high-impact события работаем только от крайних зон или ждём.',afterNews:'После новости ждём первый импульс, sweep ближайшей ликвидности и закрепление.',avoid:'Не торговать за 10 минут до/после новости без структуры.'},
    ictNarrative:'Сначала определяем, есть ли high-impact катализатор. До новости не принимать середину диапазона за сетап. После новости смотреть, какую сторону сняли первой, где цена закрепилась и есть ли continuation через USD/DXY/risk sentiment.'
  }
}
function impactOf(c){
  const e=(c.event||'').toLowerCase(), im=(c.impact||'').toLowerCase()
  if(im.includes('high')||/cpi|pce|nfp|payroll|rate|fed|ecb|powell|lagarde|jobs|unemployment|gdp/i.test(e)) return 'high'
  if(im.includes('medium')||/pmi|retail|confidence|claims|speech/i.test(e)) return 'medium'
  return 'low'
}
function filterNews(news, selected){
  if(selected==='ALL') return news.slice(0,16)
  const q=ASSETS.find(a=>a.id===selected)?.queries||[]
  return news.filter(n=>q.some(w=>(`${n.headline} ${n.summary||''}`).toLowerCase().includes(w.toLowerCase()))).slice(0,16)
}

function Loading(){return <div className="boot"><div className="orb"/><div className="boot-grid"><span/><span/><span/><span/></div><h1>MARKET DEVILS</h1><p>загружаю макро-карту · календарь · новости · риск-события</p><div className="loader"><i/></div></div>}
function Pill({active,children,onClick}){return <button onClick={onClick} className={`pill ${active?'active':''}`}>{children}</button>}
function KeyBox({label,value,tone}){return <div className={`keybox ${tone||''}`}><span>{label}</span><b>{value}</b></div>}
function NewsCard({n}){return <article className="news-card"><div><b>{n.headline}</b><p>{n.summary||n.source||'Без описания'}</p></div><span>{n.datetime?timeFmt(n.datetime*1000):'—'}</span></article>}
function EventRow({e}){const im=impactOf(e); return <div className={`event ${im}`}><div className="impact-dot"/><b>{timeFmt(e.date)}</b><span>{e.country}</span><p>{e.event}</p><em>{e.estimate?`прогноз ${e.estimate}`:''}</em></div>}

export default function App(){
  const [keys,setKeys]=useState(()=>({groq:localStorage.getItem(LS.groq)||'',finnhub:localStorage.getItem(LS.finnhub)||'',model:localStorage.getItem(LS.model)||'llama-3.1-8b-instant'}))
  const [selected,setSelected]=useState('ALL')
  const [news,setNews]=useState([]), [calendar,setCalendar]=useState([]), [ai,setAi]=useState(null)
  const [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [err,setErr]=useState(''), [updated,setUpdated]=useState(null)
  const macro=useMemo(()=>ai||localMacro(news,calendar,selected),[ai,news,calendar,selected])
  const visibleNews=useMemo(()=>filterNews(news,selected),[news,selected])
  const highEvents=useMemo(()=>calendar.filter(e=>impactOf(e)!=='low').sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,12),[calendar])
  const save=(k,v)=>{ const next={...keys,[k]:v}; setKeys(next); localStorage.setItem(LS[k],v) }
  const refresh=useCallback(async(useAi=false)=>{
    setBusy(true); setErr('')
    try{
      const [n,c]=await Promise.all([fetchFinnhubNews(keys.finnhub),fetchFinnhubCalendar(keys.finnhub)])
      setNews(n); setCalendar(c); setUpdated(new Date())
      if(useAi&&keys.groq){ setAi(await groqAnalyze(keys.groq,keys.model,{news:n.slice(0,15),calendar:c.slice(0,25),asset:selected})) }
      else setAi(null)
    }catch(e){ setErr(e.message) }
    finally{ setBusy(false); setLoading(false) }
  },[keys.finnhub,keys.groq,keys.model,selected])
  useEffect(()=>{ refresh(false); const t=setInterval(()=>refresh(false),60000); return()=>clearInterval(t) },[refresh])
  useEffect(()=>{ const t=setTimeout(()=>setLoading(false),1000); return()=>clearTimeout(t)},[])
  if(loading) return <Loading />
  return <div className="app">
    <header className="topbar">
      <div className="brand"><span>◈</span><b>MARKET DEVILS</b><em>MACRO COMMAND CENTER</em></div>
      <div className="top-status"><span>LIVE</span><b>{updated?timeFmt(updated):'--:--'}</b><em>автообновление 60с</em></div>
    </header>

    <section className="hero">
      <div className="hero-left">
        <div className="asset-tabs">{ASSETS.map(a=><Pill key={a.id} active={selected===a.id} onClick={()=>setSelected(a.id)}>{a.emoji} {a.label}</Pill>)}</div>
        <h1>{macro.headline}</h1>
        <p>{macro.ictNarrative}</p>
        <div className="driver-list">{macro.drivers?.map((d,i)=><span key={i}>{d}</span>)}</div>
      </div>
      <div className="hero-grid">
        <KeyBox label="Macro Bias" value={macro.macroBias} tone={macro.macroBias==='RISK_OFF'?'bad':'good'} />
        <KeyBox label="Dollar Bias" value={macro.dollarBias} tone={macro.dollarBias==='BULLISH'?'good':''} />
        <KeyBox label="Confidence" value={`${macro.confidence}%`} />
        <KeyBox label="Risk Events" value={highEvents.length} tone={highEvents.length?'warn':'good'} />
      </div>
    </section>

    <main className="workspace">
      <section className="panel main-panel">
        <div className="panel-head"><h2>Bias Matrix</h2><button onClick={()=>refresh(true)} disabled={busy||!keys.groq}>AI трактовка</button></div>
        <div className="bias-grid">{macro.assetBias?.map((a,i)=><div className={`bias-card ${a.bias.includes('SHORT')?'short':a.bias.includes('LONG')?'long':'wait'}`} key={i}>
          <div><b>{a.asset}</b><span>{a.bias}</span></div><p>{a.reason}</p><dl><dt>Триггер</dt><dd>{a.trigger}</dd><dt>Отмена</dt><dd>{a.risk}</dd></dl>
        </div>)}</div>
      </section>

      <section className="panel calendar-panel">
        <div className="panel-head"><h2>Календарь риска</h2><span>ForexFactory-style</span></div>
        <div className="event-list">{highEvents.map((e,i)=><EventRow key={i} e={e}/>)}</div>
      </section>

      <section className="panel plan-panel">
        <div className="panel-head"><h2>Execution Protocol</h2><span>без графика · только решение</span></div>
        <div className="protocol">
          <div><b>1. До новости</b><p>{macro.executionPlan?.beforeNews}</p></div>
          <div><b>2. После импульса</b><p>{macro.executionPlan?.afterNews}</p></div>
          <div><b>3. Не торговать</b><p>{macro.executionPlan?.avoid}</p></div>
        </div>
      </section>

      <section className="panel macro-panel">
        <div className="panel-head"><h2>Макро трактовка новостей</h2><span>{visibleNews.length} заголовков</span></div>
        <div className="news-stack">{visibleNews.map((n,i)=><NewsCard key={n.id||i} n={n}/>)}</div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head"><h2>API Кабинет</h2><span>ключи только в браузере</span></div>
        <label>Finnhub API key<input value={keys.finnhub} onChange={e=>save('finnhub',e.target.value)} placeholder="вставь Finnhub key" /></label>
        <label>Groq API key<input value={keys.groq} onChange={e=>save('groq',e.target.value)} placeholder="вставь Groq key для AI трактовки" /></label>
        <label>Groq model<input value={keys.model} onChange={e=>save('model',e.target.value)} /></label>
        {err&&<div className="err">{err}</div>}
      </section>
    </main>

    <footer>© Market Devils · Macro-first terminal · Финансовый совет не предоставляется</footer>
  </div>
}
