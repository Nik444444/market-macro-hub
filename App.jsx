import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'

const LS = { groq:'md_groq_key', finnhub:'md_finnhub_key', model:'md_model', autoAi:'md_auto_ai' }
const DEFAULT_KEYS = {
  groq: import.meta.env.VITE_GROQ_API_KEY || '',
  finnhub: import.meta.env.VITE_FINNHUB_API_KEY || '',
  model: import.meta.env.VITE_GROQ_MODEL || 'llama-3.1-8b-instant'
}
const AI_CACHE_KEY = 'md_ai_cache_v21'
const AI_COOLDOWN_MS = 5 * 60_000
const AI_STALE_MS = 5 * 60_000
const ASSETS = [
  { id:'ALL', label:'MARKET', name:'Глобальный рынок', emoji:'🌐', icon:'◇', className:'market', queries:['forex','federal reserve','ecb','inflation','jobs','dollar','gold','treasury','risk','oil','iran'] },
  { id:'EURUSD', label:'EUR/USD', name:'Евро против доллара', emoji:'🇪🇺', icon:'€', className:'eur', queries:['euro','ecb','eurusd','eurozone','dollar','lagarde','germany','italy','france'] },
  { id:'GBPUSD', label:'GBP/USD', name:'Фунт против доллара', emoji:'🇬🇧', icon:'£', className:'gbp', queries:['pound','boe','gbpusd','uk inflation','dollar','bailey','sterling'] },
  { id:'XAUUSD', label:'XAU/USD', name:'Золото', emoji:'🥇', icon:'Au', className:'gold', queries:['gold','xau','treasury yields','real yields','dollar','safe haven','war','iran','oil'] },
  { id:'NASDAQ', label:'NASDAQ', name:'Tech / risk-on', emoji:'🟦', icon:'NQ', className:'nasdaq', queries:['nasdaq','technology','ai stocks','nvidia','fed','yields','risk sentiment','stocks'] },
  { id:'SP500', label:'S&P 500', name:'Широкий рынок США', emoji:'🇺🇸', icon:'SP', className:'spx', queries:['sp500','s&p','stocks','risk sentiment','fed','yields','earnings','inflation'] },
  { id:'GER40', label:'GER40', name:'DAX / Европа', emoji:'🇩🇪', icon:'DAX', className:'dax', queries:['dax','germany','eurozone','ecb','european stocks','german inflation','bund'] },
]
const nowIsoDate = (offset=0)=>{ const d=new Date(); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10) }
const timeFmt = d => new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(d))
const safeJson = txt => { try { return JSON.parse(txt) } catch { const a=txt.indexOf('{'), b=txt.lastIndexOf('}'); if(a>=0&&b>a){ try{return JSON.parse(txt.slice(a,b+1))}catch{}} return null } }
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n))

const stripHtml = (v='') => String(v)
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'")
  .replace(/\s+/g,' ')
  .trim()
const shortText = (v='', n=220) => { const t=stripHtml(v); return t.length>n ? t.slice(0,n).trim()+'…' : t }
const newsImpact = (n) => {
  const t=(`${n.headline||''} ${n.summary||''}`).toLowerCase()
  if(/cpi|pce|inflation|fed|fomc|powell|ecb|rate|yields|payroll|nfp|gdp|war|iran|oil|sanction/.test(t)) return 'HIGH'
  if(/dollar|gold|stocks|nasdaq|sp500|euro|pound|treasury|confidence|pmi|retail/.test(t)) return 'MEDIUM'
  return 'LOW'
}
const ruTake = (n, selected='ALL') => {
  const t=(`${n.headline||''} ${n.summary||''}`).toLowerCase()
  if(/inflation|cpi|pce|ppi/.test(t)) return 'Инфляция: важно для USD, доходностей, золота и индексов. Сравни факт с прогнозом и жди закрепления после первой реакции.'
  if(/fed|fomc|powell|rate|treasury|yield/.test(t)) return 'Ставки/доходности: если USD и yields усиливаются — давление на EUR/GBP/XAU и риск для индексов.'
  if(/ecb|lagarde|eurozone|germany|italy|france/.test(t)) return 'Европа/ECB: прямой драйвер для EUR/USD и GER40. Важна реакция евро и европейских индексов.'
  if(/boe|pound|sterling|uk/.test(t)) return 'UK/BoE: драйвер GBP/USD. Проверяй, подтверждает ли GBP движение EUR против USD.'
  if(/gold|xau|safe haven|iran|war|geopolitical|oil/.test(t)) return 'Risk event / safe haven: следи за XAU/USD и нефтью. Возможен резкий risk-off или разворот на деэскалации.'
  if(/nasdaq|sp500|stocks|earnings|ai|nvidia/.test(t)) return 'Индексы: новость влияет через risk sentiment. Лучше торговать после реакции USD/yields.'
  return 'Макро-заголовок: не входить по самому тексту, ждать реакции рынка и подтверждения направления.'
}

function demoNews(){return [
  {id:'n1', datetime:Date.now()/1000, source:'Macro Desk', headline:'Dollar holds firm before US inflation data as yields stay elevated', summary:'Markets wait for CPI and Fed speakers. EUR/USD remains sensitive to dollar repricing.'},
  {id:'n2', datetime:Date.now()/1000-1800, source:'Macro Desk', headline:'Gold consolidates as traders watch real yields and risk sentiment', summary:'XAU/USD may stay bid if yields fall or risk-off flow returns.'},
  {id:'n3', datetime:Date.now()/1000-3600, source:'Macro Desk', headline:'European currencies trade cautiously before ECB commentary', summary:'EUR and GBP need clean catalyst; range conditions remain possible until US session.'},
  {id:'n4', datetime:Date.now()/1000-5400, source:'Macro Desk', headline:'US equity futures mixed ahead of key macro calendar', summary:'Indices are vulnerable to high-impact data and Fed repricing.'},
]}
function demoCalendar(){ const today=nowIsoDate(0); return [
  {id:'c1', date:`${today} 08:00:00`, country:'EUR', event:'German CPI m/m', impact:'medium', actual:'', estimate:'0.2%', previous:'0.1%'},
  {id:'c2', date:`${today} 11:00:00`, country:'EUR', event:'ECB President Speech', impact:'high', actual:'', estimate:'', previous:''},
  {id:'c3', date:`${today} 14:30:00`, country:'USD', event:'Core PCE Price Index', impact:'high', actual:'', estimate:'0.3%', previous:'0.2%'},
  {id:'c4', date:`${today} 16:00:00`, country:'USD', event:'Consumer Confidence', impact:'medium', actual:'', estimate:'101.0', previous:'99.8'},
]}

function impactOf(c){ const e=(c.event||'').toLowerCase(), im=(c.impact||'').toLowerCase(); if(im.includes('high')||/cpi|pce|nfp|payroll|rate|fed|ecb|fomc|powell|lagarde|jobs|unemployment|gdp|ism/i.test(e)) return 'high'; if(im.includes('medium')||/pmi|retail|confidence|claims|speech|ppi/i.test(e)) return 'medium'; return 'low' }
function eventMeaning(e){ const name=(e.event||'').toLowerCase(); if(/cpi|pce|ppi|inflation/.test(name)) return 'Инфляция: выше прогноза обычно поддерживает USD/yields и давит на gold/indices; ниже прогноза наоборот.'; if(/fed|fomc|powell|rate/.test(name)) return 'Fed/ставки: рынок ищет hawkish/dovish repricing. Торговать только после первой реакции.'; if(/ecb|lagarde/.test(name)) return 'ECB: влияет на EUR и через EURUSD может смещать dollar basket.'; if(/nfp|payroll|jobs|unemployment|claims/.test(name)) return 'Рынок труда: сильные данные = поддержка USD; слабые = риск снижения USD.'; if(/pmi|ism/.test(name)) return 'PMI/ISM: показывает growth impulse, важен для risk-on/risk-off.'; return 'Риск-событие: дождаться факта, первой реакции и закрепления.' }
async function fetchFinnhubNews(key){ if(!key) return demoNews(); const cats=['forex','general']; const results=[]; for(const cat of cats){ try{ const r=await fetch(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`); const d=await r.json(); if(Array.isArray(d)) results.push(...d.slice(0,28)) }catch{} } const map=new Map(); results.forEach(n=>{ if(n.headline&&!map.has(n.headline)) map.set(n.headline,n) }); return [...map.values()].slice(0,36).map(n=>({...n, headline:shortText(n.headline,170), summary:shortText(n.summary||n.description||'',260)})) }
async function fetchFinnhubCalendar(key){ if(!key) return demoCalendar(); try{ const r=await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${nowIsoDate(-1)}&to=${nowIsoDate(2)}&token=${key}`); const d=await r.json(); const arr=d.economicCalendar||d.calendar||[]; if(Array.isArray(arr)&&arr.length) return arr.slice(0,90).map((e,i)=>({id:i,date:e.time||e.date||e.datetime,country:e.country||e.region||'',event:e.event||e.name||e.indicator||'',impact:(e.impact||e.importance||'').toString().toLowerCase(),actual:e.actual,estimate:e.estimate||e.forecast,previous:e.prev||e.previous})) }catch{} return demoCalendar() }

function filterNews(news, selected){
  if(selected==='ALL') return news.slice(0,18)
  const q=ASSETS.find(a=>a.id===selected)?.queries||[]
  const filtered = news.filter(n=>q.some(w=>(`${n.headline} ${n.summary||''}`).toLowerCase().includes(w.toLowerCase()))).slice(0,18)
  // если Finnhub не дал точных новостей по активу — не показываем пустоту, а даём общий macro-flow
  return filtered.length >= 4 ? filtered : news.slice(0,12)
}
function localMacro(news, calendar, selected='ALL'){
  const selectedAsset = ASSETS.find(a=>a.id===selected) || ASSETS[0]
  const selectedNews = selected==='ALL' ? news : filterNews(news, selected)
  const text=[...selectedNews.map(n=>`${n.headline} ${n.summary||''}`),...calendar.map(c=>`${c.country} ${c.event}`)].join(' ').toLowerCase()
  let usd=0, risk=0, gold=0, eur=0, gbp=0
  ;['fed','rate','yield','inflation','cpi','pce','dollar','hawkish','treasury','jobs','payroll'].forEach(w=>{ if(text.includes(w)) usd+=1 })
  ;['risk','stocks','nasdaq','sp500','confidence','growth','soft landing'].forEach(w=>{ if(text.includes(w)) risk+=1 })
  ;['gold','xau','war','geopolitical','safe haven','real yields'].forEach(w=>{ if(text.includes(w)) gold+=1 })
  ;['ecb','euro','eurozone','germany','lagarde'].forEach(w=>{ if(text.includes(w)) eur+=1 })
  ;['boe','pound','uk','bailey','sterling'].forEach(w=>{ if(text.includes(w)) gbp+=1 })
  const high=calendar.filter(c=>impactOf(c)==='high').sort((a,b)=>new Date(a.date)-new Date(b.date))
  const medium=calendar.filter(c=>impactOf(c)==='medium')
  const dollarBias=usd>=3?'BULLISH':text.includes('weak dollar')?'BEARISH':'NEUTRAL'
  const macroBias=high.length?'EVENT_RISK':risk>=4&&dollarBias!=='BULLISH'?'RISK_ON':gold>=2?'RISK_OFF':'NEUTRAL'
  const confidence=clamp(54+high.length*8+usd*3+risk*2,52,88)
  const primary= selected==='ALL' ? (high[0]?.country==='USD'?'USD calendar':high[0]?.country==='EUR'?'EUR calendar':high[0]?.event||'headline flow') : selectedAsset.label
  const eurBias=dollarBias==='BULLISH'?'SHORT':eur>usd?'LONG':'WAIT'
  const gbpBias=dollarBias==='BULLISH'?'SHORT':gbp>usd?'LONG':'WAIT'
  const xauBias=dollarBias==='BULLISH'?'SHORT':gold>=2?'LONG':'WAIT'
  const idxBias=macroBias==='RISK_ON'?'LONG':macroBias==='EVENT_RISK'?'WAIT':'WAIT'
  return {
    macroBias,dollarBias,confidence,primaryAsset:primary,
    headline: high.length?`Главное сегодня: ${high[0].country} ${high[0].event} в ${timeFmt(high[0].date)}`:'Сегодня работаем от заголовков и реакции USD/yields',
    drivers:[ high.length?`High impact: ${high.length}`:'High impact нет', medium.length?`Medium impact: ${medium.length}`:'Medium impact мало', dollarBias==='BULLISH'?'USD под давлением ставок/доходностей':'USD без жёсткого преимущества', macroBias==='EVENT_RISK'?'До новостей лучше снижать риск':'Можно работать от потока заголовков' ],
    regime:{label: macroBias==='EVENT_RISK'?'NEWS DRIVEN':macroBias==='RISK_ON'?'RISK ON':macroBias==='RISK_OFF'?'RISK OFF':'BALANCED', meaning: macroBias==='EVENT_RISK'?'Рынок может стоять до публикации и резко расшириться после факта.':'Без сильного календаря важнее реакция на заголовки и USD.'},
    assetBias:[
      {asset:'EUR/USD',bias:eurBias,reason:eurBias==='SHORT'?'USD strong narrative давит на пару.':eurBias==='LONG'?'EUR catalyst сильнее USD narrative.':'Нет чистого преимущества.',trigger:'снятие ликвидности + закрепление после USD/EUR события',risk:'возврат в диапазон после новости'},
      {asset:'GBP/USD',bias:gbpBias,reason:gbpBias==='SHORT'?'GBP уязвим при сильном USD.':gbpBias==='LONG'?'GBP получает локальный драйвер.':'Ждать синхронизации с EUR/USD.',trigger:'GBP и EUR двигаются против USD одновременно',risk:'GBP diverges from EUR'},
      {asset:'XAU/USD',bias:xauBias,reason:xauBias==='SHORT'?'Рост USD/yields обычно давит на золото.':xauBias==='LONG'?'Risk-off/safe haven поддерживает золото.':'Нужна реакция real yields.',trigger:'yields вниз или risk-off headlines',risk:'резкий рост real yields'},
      {asset:'NASDAQ',bias:idxBias,reason:idxBias==='LONG'?'Risk-on и снижение yields поддерживают tech.':'Перед macro событием лучше ждать факта.',trigger:'мягкие данные + USD/yields вниз + risk-on headlines',risk:'hawkish surprise / yields up'},
      {asset:'S&P 500',bias:idxBias,reason:idxBias==='LONG'?'Широкий risk-on поддерживает SPX.':'Без чистого macro импульса лучше ждать.',trigger:'синхронное ослабление USD/yields и рост futures',risk:'hot inflation / Fed hawkish'},
      {asset:'GER40',bias:eur>usd?'LONG':'WAIT',reason:eur>usd?'Европейский драйвер поддерживает GER40 при risk-on.':'Нужна реакция DAX на ECB/EUR данные.',trigger:'мягкий ECB/EU data + risk-on в Европе',risk:'сильный EUR давит на экспортёров / risk-off'}
    ],
    riskEvents: high.slice(0,8).map(c=>({time:timeFmt(c.date),event:c.event,impact:'HIGH',meaning:eventMeaning(c)})),
    executionPlan:{beforeNews:'До high-impact новости не брать сделки в середине диапазона. Работать только край/ликвидность/очевидный дисбаланс.',afterNews:'После факта ждем: 1) первый импульс, 2) sweep ближайшей ликвидности, 3) закрепление, 4) continuation через USD/DXY/yields.',avoid:'Избегать входов за 10 минут до новости, сразу на первой свече новости и когда assets дают конфликт.'},
    ictNarrative:'Логика дня: сначала определить главный катализатор, потом ждать какую сторону снимут первой. Если после новости USD закрепляется, приоритет пары против USD вниз. Если USD/yields падают — EUR/GBP/XAU получают шанс на long, indices могут получить risk-on. Без закрепления это не сетап, а шум.',
    scenarios:[
      {name:'USD Bullish Surprise',prob:dollarBias==='BULLISH'?72:54,play:'EUR/USD и GBP/USD short после sweep вверх и закрепления ниже; XAU осторожно short; indices wait/short при yields up.'},
      {name:'USD Bearish / Soft Data',prob:dollarBias==='BEARISH'?70:50,play:'EUR/USD, GBP/USD, XAU/USD long после sweep вниз и reclaim; indices long если risk-on подтверждается.'},
      {name:'Fakeout Range Day',prob:high.length?58:46,play:'Если после новости цена возвращается в диапазон — не гнаться, работать от противоположного края.'}
    ]
  }
}
async function groqAnalyze(key, model, payload){
  if(!key) throw new Error('Нет Groq key')
  const prompt=`Ты macro trader. Верни СТРОГО JSON на русском, коротко, без markdown. Не выдумывай факты. Поля:
{"macroBias":"RISK_ON/RISK_OFF/EVENT_RISK/NEUTRAL","dollarBias":"BULLISH/BEARISH/NEUTRAL","primaryAsset":"driver","confidence":0-100,"headline":"1 фраза","drivers":["4 коротких пункта"],"regime":{"label":"NEWS DRIVEN/RISK ON/RISK OFF/BALANCED","meaning":"1 фраза"},"assetBias":[{"asset":"EUR/USD","bias":"LONG/SHORT/WAIT","reason":"1 фраза","trigger":"условие","risk":"отмена"}],"executionPlan":{"beforeNews":"до","afterNews":"после","avoid":"не торговать"},"scenarios":[{"name":"сценарий","prob":0-100,"play":"действие"}],"ictNarrative":"4-5 коротких строк"}`
  const smallPayload = JSON.stringify(payload).slice(0,760)
  const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:model||'llama-3.1-8b-instant',temperature:.08,max_tokens:320,messages:[{role:'system',content:prompt},{role:'user',content:smallPayload}]})})
  const d=await res.json()
  if(d.error){
    const msg=d.error.message||'Groq error'
    const rate=/rate limit|TPM|tokens per minute/i.test(msg)
    const err=new Error(rate?'AI временно занят лимитом. Показываю сохранённую/локальную трактовку, повторю автоматически.':msg)
    err.rateLimited=rate
    throw err
  }
  const j=safeJson(d.choices?.[0]?.message?.content||'')
  if(!j) throw new Error('AI вернул не JSON')
  return j
}

function Loading(){return <div className="boot"><div className="sonar-bg"/><div className="sonar-core"><span/><i/><b>MD</b></div><h1>MARKET DEVILS</h1><p>собираю macro flow · risk calendar · asset bias · execution protocol</p><div className="boot-ticks"><span>MACRO RADAR</span><span>RISK EVENTS</span><span>AI BRIEFING</span></div><div className="loader"><i/></div></div>}
function AssetTab({asset,active,onClick,macro}){
  const assetBias = macro?.assetBias?.find(x => x.asset?.replace('/','').toUpperCase().includes(asset.id.replace('SP500','SP').replace('NASDAQ','NASDAQ')) || x.asset===asset.label)
  const b = asset.id==='ALL' ? macro?.macroBias : assetBias?.bias || 'SCAN'
  return <button onClick={onClick} className={`asset-card ${asset.className} ${active?'active':''}`}>
    <span className="asset-icon">{asset.icon}</span>
    <span><b>{asset.label}</b><em>{asset.name}</em></span>
    <strong className={String(b).toLowerCase()}>{b}</strong>
  </button>
}
function MarketPulse({macro}){
  const list = macro?.assetBias || []
  return <div className="pulse-grid">
    <div className="pulse-main"><span>Market Mode</span><b>{macro.regime?.label||macro.macroBias}</b><em>{macro.regime?.meaning||'режим рассчитывается из новостей и календаря'}</em></div>
    <div><span>USD Bias</span><b>{macro.dollarBias}</b><em>ключ для FX / Gold / Indices</em></div>
    <div><span>Confidence</span><b>{macro.confidence}%</b><em>сила совпадения факторов</em></div>
    <div><span>Focus</span><b>{macro.primaryAsset}</b><em>главный драйвер дня</em></div>
    {list.slice(0,4).map((a,i)=><div key={i}><span>{a.asset}</span><b className={a.bias?.toLowerCase()}>{a.bias}</b><em>{a.trigger}</em></div>)}
  </div>
}
function KeyBox({label,value,tone,sub}){return <div className={`keybox ${tone||''}`}><span>{label}</span><b>{value}</b>{sub&&<em>{sub}</em>}</div>}
function EventRow({e}){const im=impactOf(e); return <div className={`event ${im}`}><div className="impact-dot"/><b>{timeFmt(e.date)}</b><span>{e.country}</span><p>{e.event}</p><em>{e.estimate?`прогноз ${e.estimate}`:''}</em></div>}
function NewsCard({n,selected}){const im=newsImpact(n); return <article className={`news-card ${im.toLowerCase()}`}><div><div className="news-meta"><em>{im}</em><small>{n.source||'News'}</small></div><b>{shortText(n.headline,160)}</b><p>{shortText(n.summary||'',210)}</p><strong>{ruTake(n,selected)}</strong></div><span>{n.datetime?timeFmt(n.datetime*1000):'—'}</span></article>}
function BiasCard({a}){return <div className={`bias-card ${a.bias?.includes('SHORT')?'short':a.bias?.includes('LONG')?'long':'wait'}`}><div><b>{a.asset}</b><span>{a.bias}</span></div><p>{a.reason}</p><dl><dt>Активация</dt><dd>{a.trigger}</dd><dt>Отмена</dt><dd>{a.risk}</dd></dl></div>}
function AssetFocus({asset,macro}){
  const b = macro?.assetBias?.find(x => (x.asset||'').replace('/','').toUpperCase().includes(asset.id.replace('SP500','SP').replace('NASDAQ','NASDAQ')) || x.asset===asset.label) || macro?.assetBias?.[0]
  return <section className="panel wide asset-focus">
    <div className="panel-head"><h2>{asset.label} — активный план</h2><span>личный bias + условия исполнения</span></div>
    <div className="asset-focus-grid">
      <div className="focus-hero"><span>{asset.icon}</span><div><b>{b?.bias || 'WAIT'}</b><p>{b?.reason || 'Ждём подтверждения через новости, USD/yields и реакцию после факта.'}</p></div></div>
      <div><small>Активация</small><p>{b?.trigger || 'сначала новость / импульс, затем закрепление и подтверждение направления'}</p></div>
      <div><small>Отмена</small><p>{b?.risk || 'если после новости цена возвращается в диапазон и USD/yields не подтверждают движение'}</p></div>
      <div><small>Что смотреть</small><p>USD bias, календарь риска, реакцию золота/индексов и синхронность с коррелирующими активами.</p></div>
    </div>
  </section>
}

function ScenarioCard({s}){return <div className="scenario"><div><b>{s.name}</b><span>{s.prob}%</span></div><p>{s.play}</p><div className="prob"><i style={{width:`${clamp(s.prob||0,0,100)}%`}}/></div></div>}

export default function App(){
  const [keys]=useState(()=>({
    groq: DEFAULT_KEYS.groq || localStorage.getItem(LS.groq) || '',
    finnhub: DEFAULT_KEYS.finnhub || localStorage.getItem(LS.finnhub) || '',
    model: DEFAULT_KEYS.model || localStorage.getItem(LS.model) || 'llama-3.1-8b-instant',
    autoAi: true
  }))
  const [selected,setSelected]=useState('ALL')
  const [news,setNews]=useState([])
  const [calendar,setCalendar]=useState([])
  const [aiCache,setAiCache]=useState(()=>{ try{return JSON.parse(localStorage.getItem(AI_CACHE_KEY)||'{}')}catch{return {}} })
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const [updated,setUpdated]=useState(null)
  const [aiStatus,setAiStatus]=useState('локальный анализ')
  const selectedRef=useRef(selected)
  const inFlightRef=useRef(false)
  const lastCallRef=useRef(0)
  const blockedUntilRef=useRef(0)
  const debounceRef=useRef(null)

  useEffect(()=>{ selectedRef.current = selected },[selected])
  useEffect(()=>{ localStorage.setItem(AI_CACHE_KEY, JSON.stringify(aiCache)) },[aiCache])

  const activeAsset=useMemo(()=>ASSETS.find(a=>a.id===selected)||ASSETS[0],[selected])
  const local=useMemo(()=>localMacro(news,calendar,selected),[news,calendar,selected])
  const allLocal=useMemo(()=>localMacro(news,calendar,'ALL'),[news,calendar])
  const cachedAll = aiCache.ALL?.data
  const macro=useMemo(()=>{
    const source = selected === 'ALL' && cachedAll ? {...allLocal,...cachedAll} : local
    return {
      ...source,
      assetBias: Array.isArray(source.assetBias) && source.assetBias.length ? source.assetBias : local.assetBias,
      drivers: Array.isArray(source.drivers) && source.drivers.length ? source.drivers : local.drivers,
      scenarios: Array.isArray(source.scenarios) && source.scenarios.length ? source.scenarios : local.scenarios,
      executionPlan: source.executionPlan || local.executionPlan
    }
  },[selected,cachedAll,allLocal,local])
  const visibleNews=useMemo(()=>filterNews(news,selected),[news,selected])
  const highEvents=useMemo(()=>calendar.filter(e=>impactOf(e)!=='low').sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,14),[calendar])

  const shouldRefreshAi = useCallback((assetId)=>{
    if(assetId !== 'ALL') return false
    if(!keys.groq || !keys.autoAi) return false
    const cachedAt = aiCache.ALL?.ts || 0
    return Date.now() - cachedAt > AI_STALE_MS
  },[keys.groq, keys.autoAi, aiCache])

  const runAiFor = useCallback(async(assetId, n=news, c=calendar, {force=false}={})=>{
    if(!keys.groq || !keys.autoAi) { setAiStatus('локальный анализ'); return }
    if(inFlightRef.current) return
    if(!force && !shouldRefreshAi(assetId)) { setAiStatus('сохранённая AI трактовка'); return }
    const now=Date.now()
    if(now < blockedUntilRef.current) { setAiStatus('AI лимит — показан кэш'); return }
    if(now - lastCallRef.current < AI_COOLDOWN_MS && !force) { setAiStatus('AI ждёт кулдаун'); return }

    inFlightRef.current=true
    lastCallRef.current=now
    setAiStatus(`AI обновляет ${ASSETS.find(a=>a.id===assetId)?.label||assetId}`)
    const assetNews = filterNews(n, assetId).slice(0,2)
    const importantCal = c.filter(x=>impactOf(x)!=='low').slice(0,3)
    const base = localMacro(n,c,assetId)
    try{
      const result=await groqAnalyze(keys.groq,keys.model,{asset:assetId, local:{macroBias:base.macroBias,dollarBias:base.dollarBias,headline:base.headline,drivers:base.drivers}, news:assetNews.map(x=>({h:shortText(x.headline,90),i:newsImpact(x)})), calendar:importantCal.map(x=>({c:x.country,e:shortText(x.event,70),i:impactOf(x),t:x.date}))})
      setAiCache(prev=>({...prev,[assetId]:{ts:Date.now(),data:result}}))
      setAiStatus('AI трактовка обновлена')
      setErr('')
    }catch(e){
      if(e.rateLimited){ blockedUntilRef.current=Date.now()+75_000; setAiStatus('AI лимит — повторю автоматически') }
      else { setAiStatus('локальный анализ') }
    }finally{ inFlightRef.current=false }
  },[keys.groq,keys.model,keys.autoAi,news,calendar,shouldRefreshAi])

  const selectAsset = useCallback((id)=>{
    setSelected(id)
    setErr('')
    setAiStatus(id === 'ALL' && aiCache.ALL ? 'общий AI-бриф закреплён' : 'мгновенный локальный bias')
    clearTimeout(debounceRef.current)
  },[aiCache])

  const refreshData = useCallback(async({forceAi=false, silent=false}={})=>{
    if(!silent) setBusy(true)
    const scrollY = window.scrollY
    try{
      const [n,c]=await Promise.all([fetchFinnhubNews(keys.finnhub),fetchFinnhubCalendar(keys.finnhub)])
      setNews(n); setCalendar(c); setUpdated(new Date())
      if(forceAi) runAiFor('ALL',n,c,{force:true})
      else if(shouldRefreshAi('ALL')) runAiFor('ALL',n,c)
    } catch(e){ setErr(e.message) }
    finally{
      if(!silent) setBusy(false)
      setLoading(false)
      requestAnimationFrame(()=>{ if(silent && Math.abs(window.scrollY-scrollY)>24) window.scrollTo({top:scrollY}) })
    }
  },[keys.finnhub,runAiFor,shouldRefreshAi])

  useEffect(()=>{
    refreshData({forceAi:false})
    const t=setInterval(()=>refreshData({silent:true}),60000)
    return()=>clearInterval(t)
  },[refreshData])

  useEffect(()=>()=>clearTimeout(debounceRef.current),[])

  if(loading) return <Loading />
  return <div className="app">
    <header className="topbar"><div className="brand"><span>◈</span><b>MARKET DEVILS</b><em>MACRO OS</em></div><div className="top-status"><span>{busy?'SYNC':'LIVE'}</span><b>{updated?timeFmt(updated):'--:--'}</b><em>{aiStatus}</em><button className="mini-refresh" onClick={()=>refreshData({forceAi:true})}>↻</button></div></header>
    <section className="nav-strip terminal-card"><div className="nav-scroll">{ASSETS.map(a=><AssetTab key={a.id} asset={a} active={selected===a.id} macro={macro} onClick={()=>selectAsset(a.id)}/>)}</div></section>
    <section className="hero terminal-card"><div className="hero-left"><h1>{macro.headline}</h1><p>{macro.ictNarrative}</p><div className="driver-list">{macro.drivers?.map((d,i)=><span key={i}>{d}</span>)}</div></div><MarketPulse macro={macro}/></section>
    <main className="workspace no-settings">
      {selected==='ALL'
        ? <section className="panel wide"><div className="panel-head"><h2>Bias Matrix — что торговать сегодня</h2><span>закреплено во вкладке MARKET</span></div><div className="bias-grid">{macro.assetBias?.map((a,i)=><BiasCard key={i} a={a}/>)}</div></section>
        : <AssetFocus asset={activeAsset} macro={macro}/>
      }
      <section className="panel"><div className="panel-head"><h2>Сценарии снятия</h2><span>что ждать первым</span></div><div className="scenario-grid">{macro.scenarios?.map((s,i)=><ScenarioCard key={i} s={s}/>)}</div></section>
      <section className="panel"><div className="panel-head"><h2>Execution Protocol</h2><span>разжевано для входа</span></div><div className="protocol"><div><b>До новости</b><p>{macro.executionPlan?.beforeNews}</p></div><div><b>После факта</b><p>{macro.executionPlan?.afterNews}</p></div><div><b>Стоп-режим</b><p>{macro.executionPlan?.avoid}</p></div></div></section>
      <section className="panel calendar-panel"><div className="panel-head"><h2>Календарь риска</h2><span>high / medium impact</span></div><div className="event-list">{highEvents.map((e,i)=><EventRow key={i} e={e}/>)}</div></section>
      <section className="panel macro-panel"><div className="panel-head"><h2>{selected==='ALL'?'Новости + макро поток':`Новости по ${activeAsset.label}`}</h2><span>{visibleNews.length} заголовков · автообновление</span></div><div className="news-stack">{visibleNews.map((n,i)=><NewsCard key={n.id||n.headline||i} n={n} selected={selected}/>)}</div></section>
    </main><footer>© Market Devils · Macro OS для intraday трейдера · не является финансовым советом</footer>
  </div>
}