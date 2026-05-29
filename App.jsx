import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'

const DEFAULT_KEYS = {
  groq: import.meta.env.VITE_GROQ_API_KEY || '',
  finnhub: import.meta.env.VITE_FINNHUB_API_KEY || '',
  model: import.meta.env.VITE_GROQ_MODEL || 'llama-3.1-8b-instant'
}

const CACHE_KEY = 'md_macro_cache_v20_stable_restored'
const NEWS_REFRESH_MS = 60_000
const AI_REFRESH_MS = 5 * 60_000
const AI_RETRY_MS = 75_000

const ASSETS = [
  { id:'ALL', label:'MARKET', name:'Общий рынок', icon:'◇', className:'market', queries:['forex','federal reserve','ecb','inflation','jobs','dollar','gold','treasury','risk','oil','iran','war','stocks'] },
  { id:'EURUSD', label:'EUR/USD', name:'Euro vs Dollar', icon:'€', className:'eur', queries:['euro','ecb','eurusd','eurozone','dollar','lagarde','germany','italy','france','inflation'] },
  { id:'GBPUSD', label:'GBP/USD', name:'Pound vs Dollar', icon:'£', className:'gbp', queries:['pound','boe','gbpusd','uk inflation','dollar','bailey','sterling','bank of england'] },
  { id:'XAUUSD', label:'XAU/USD', name:'Gold', icon:'Au', className:'gold', queries:['gold','xau','treasury yields','real yields','dollar','safe haven','war','iran','oil','inflation'] },
  { id:'NASDAQ', label:'NASDAQ', name:'Tech / Risk', icon:'NQ', className:'nasdaq', queries:['nasdaq','technology','ai stocks','nvidia','fed','yields','risk sentiment','stocks','earnings'] },
  { id:'SP500', label:'S&P 500', name:'US Equity', icon:'SP', className:'spx', queries:['sp500','s&p','stocks','risk sentiment','fed','yields','earnings','inflation'] },
  { id:'GER40', label:'GER40', name:'DAX / Europe', icon:'DAX', className:'dax', queries:['dax','germany','eurozone','ecb','european stocks','german inflation','bund'] },
]

const clamp = (n,a,b)=>Math.max(a,Math.min(b,n))
const nowIsoDate = (offset=0)=>{ const d=new Date(); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10) }
const timeFmt = (d)=> new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(d))
const timeShort = (d)=> new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(d))
const nextUpdateAt = (date=new Date()) => new Date(Math.ceil(date.getTime()/AI_REFRESH_MS)*AI_REFRESH_MS)
const stripHtml = (v='') => String(v)
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<li>/gi,'• ')
  .replace(/<br\s*\/?>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'")
  .replace(/\s+/g,' ')
  .trim()
const shortText = (v='', n=220) => { const t=stripHtml(v); return t.length>n ? t.slice(0,n).trim()+'…' : t }
const safeJson = (txt='') => { try { return JSON.parse(txt) } catch { const a=txt.indexOf('{'), b=txt.lastIndexOf('}'); if(a>=0&&b>a){ try{return JSON.parse(txt.slice(a,b+1))}catch{} } return null } }

function demoNews(){ return [
  {id:'n1', datetime:Date.now()/1000, source:'Macro Desk', headline:'Dollar holds firm before US inflation data as yields stay elevated', summary:'Markets wait for CPI and Fed speakers. EUR/USD remains sensitive to dollar repricing.'},
  {id:'n2', datetime:Date.now()/1000-1800, source:'Macro Desk', headline:'Gold consolidates as traders watch real yields and risk sentiment', summary:'XAU/USD may stay bid if yields fall or risk-off flow returns.'},
  {id:'n3', datetime:Date.now()/1000-3600, source:'Macro Desk', headline:'European currencies trade cautiously before ECB commentary', summary:'EUR and GBP need clean catalyst; range conditions remain possible until US session.'},
  {id:'n4', datetime:Date.now()/1000-5400, source:'Macro Desk', headline:'US equity futures mixed ahead of key macro calendar', summary:'Indices are vulnerable to high-impact data and Fed repricing.'},
]}
function demoCalendar(){ const t=nowIsoDate(0); return [
  {id:'c1', date:`${t} 08:00:00`, country:'EUR', event:'German CPI m/m', impact:'medium', estimate:'0.2%', previous:'0.1%'},
  {id:'c2', date:`${t} 11:00:00`, country:'EUR', event:'ECB President Speech', impact:'high'},
  {id:'c3', date:`${t} 14:30:00`, country:'USD', event:'Core PCE Price Index', impact:'high', estimate:'0.3%', previous:'0.2%'},
  {id:'c4', date:`${t} 16:00:00`, country:'USD', event:'Consumer Confidence', impact:'medium', estimate:'101.0', previous:'99.8'},
]}

function impactOf(c){
  const e=(c.event||'').toLowerCase(), im=(c.impact||'').toLowerCase()
  if(im.includes('high')||/cpi|pce|nfp|payroll|rate|fed|ecb|fomc|powell|lagarde|jobs|unemployment|gdp|ism|inflation/.test(e)) return 'high'
  if(im.includes('medium')||/pmi|retail|confidence|claims|speech|ppi/.test(e)) return 'medium'
  return 'low'
}
function newsImpact(n){
  const t=(`${n.headline||''} ${n.summary||''}`).toLowerCase()
  if(/cpi|pce|inflation|fed|fomc|powell|ecb|rate|yields|payroll|nfp|gdp|war|iran|oil|sanction|ceasefire/.test(t)) return 'HIGH'
  if(/dollar|gold|stocks|nasdaq|sp500|euro|pound|treasury|confidence|pmi|retail|earnings/.test(t)) return 'MEDIUM'
  return 'LOW'
}
function ruTake(n, selected='ALL'){
  const t=(`${n.headline||''} ${n.summary||''}`).toLowerCase()
  const asset = ASSETS.find(a=>a.id===selected)?.label || 'рынок'
  if(/iran|war|ceasefire|gaza|military|sanction|oil/.test(t)) return `Геополитика: важна для нефти, золота и risk sentiment. Для ${asset}: не входить в середине движения, ждать реакции USD/yields и подтверждения после заголовка.`
  if(/inflation|cpi|pce|ppi/.test(t)) return `Инфляция: прямой драйвер USD, yields, золота и индексов. Для ${asset}: факт выше прогноза чаще усиливает USD/yields; факт ниже прогноза чаще поддерживает risk-on.`
  if(/fed|fomc|powell|rate|treasury|yield/.test(t)) return `Fed/yields: ключевой поток дня. Для ${asset}: если yields растут — давление на EUR/GBP/XAU/indices; если падают — ищем risk-on и слабость USD.`
  if(/ecb|lagarde|eurozone|germany|italy|france/.test(t)) return `Европа/ECB: прямой драйвер EUR и GER40. Для ${asset}: важна синхронизация EUR/USD и европейских индексов после факта.`
  if(/boe|pound|sterling|uk/.test(t)) return `UK/BoE: драйвер GBP/USD. Для ${asset}: GBP должен подтверждать движение EUR против USD, иначе лучше ждать.`
  if(/gold|xau|safe haven|real yields/.test(t)) return `Gold flow: следи за real yields и risk-off. Для ${asset}: XAU лучше торговать после закрепления, а не по первому импульсу.`
  if(/nasdaq|sp500|stocks|earnings|ai|nvidia|costco|salesforce|arm/.test(t)) return `Акции/индексы: поток влияет через risk sentiment. Для ${asset}: подтверждение — USD/yields вниз и сохранение bid в futures.`
  return `Макро-заголовок: для ${asset} это контекст, не сигнал. Ждать реакции цены после публикации и только потом строить сделку.`
}

async function fetchFinnhubNews(key){
  if(!key) return demoNews()
  const cats=['forex','general']; const results=[]
  for(const cat of cats){
    try{ const r=await fetch(`https://finnhub.io/api/v1/news?category=${cat}&token=${key}`); const d=await r.json(); if(Array.isArray(d)) results.push(...d.slice(0,30)) }catch{}
  }
  const map=new Map()
  results.forEach(n=>{ const h=stripHtml(n.headline||''); if(h&&!map.has(h)) map.set(h,{...n, headline:shortText(h,170), summary:shortText(n.summary||n.description||'',260)}) })
  return [...map.values()].slice(0,40)
}
async function fetchFinnhubCalendar(key){
  if(!key) return demoCalendar()
  try{
    const r=await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${nowIsoDate(-1)}&to=${nowIsoDate(2)}&token=${key}`)
    const d=await r.json(); const arr=d.economicCalendar||d.calendar||[]
    if(Array.isArray(arr)&&arr.length) return arr.slice(0,90).map((e,i)=>({id:i,date:e.time||e.date||e.datetime,country:e.country||e.region||'',event:shortText(e.event||e.name||e.indicator||'',110),impact:(e.impact||e.importance||'').toString().toLowerCase(),actual:e.actual,estimate:e.estimate||e.forecast,previous:e.prev||e.previous}))
  }catch{}
  return demoCalendar()
}

function filterNews(news, selected){
  if(selected==='ALL') return news.slice(0,18)
  const q=ASSETS.find(a=>a.id===selected)?.queries||[]
  const filtered = news.filter(n=>q.some(w=>(`${n.headline} ${n.summary||''}`).toLowerCase().includes(w.toLowerCase())))
  return (filtered.length >= 4 ? filtered : news).slice(0,18)
}
function scoreText(text, words){ return words.reduce((s,w)=>s+(text.includes(w)?1:0),0) }
function calcMacro(news, calendar, selected='ALL'){
  const selectedNews=filterNews(news,selected)
  const text=[...selectedNews.map(n=>`${n.headline} ${n.summary||''}`),...calendar.map(c=>`${c.country} ${c.event}`)].join(' ').toLowerCase()
  const scores={
    USD: scoreText(text,['fed','rate','yield','inflation','cpi','pce','dollar','hawkish','treasury','jobs','payroll','pce']),
    EUR: scoreText(text,['ecb','euro','eurozone','germany','italy','france','lagarde']),
    GBP: scoreText(text,['boe','pound','uk','bailey','sterling']),
    GOLD: scoreText(text,['gold','xau','safe haven','war','iran','geopolitical','real yields']),
    RISK: scoreText(text,['risk','stocks','nasdaq','sp500','growth','soft landing','earnings','ceasefire']) - scoreText(text,['war','sanction','hot inflation','hawkish'])
  }
  const high=calendar.filter(c=>impactOf(c)==='high').sort((a,b)=>new Date(a.date)-new Date(b.date))
  const medium=calendar.filter(c=>impactOf(c)==='medium')
  const dollarBias=scores.USD>=4?'BULLISH':/weak dollar|dollar weak/.test(text)?'BEARISH':'NEUTRAL'
  const macroBias=high.length?'EVENT_RISK':scores.RISK>=3&&dollarBias!=='BULLISH'?'RISK_ON':scores.GOLD>=2?'RISK_OFF':'NEUTRAL'
  const confidence=clamp(54+high.length*7+scores.USD*3+Math.abs(scores.RISK)*3,50,88)
  const eurBias=dollarBias==='BULLISH'?'SHORT':scores.EUR>scores.USD?'LONG':'WAIT'
  const gbpBias=dollarBias==='BULLISH'?'SHORT':scores.GBP>scores.USD?'LONG':'WAIT'
  const xauBias=dollarBias==='BULLISH'&&scores.GOLD<3?'SHORT':scores.GOLD>=2||macroBias==='RISK_OFF'?'LONG':'WAIT'
  const idxBias=macroBias==='RISK_ON'?'LONG':macroBias==='EVENT_RISK'?'WAIT':dollarBias==='BULLISH'?'SHORT':'WAIT'
  const gerBias=scores.EUR>=scores.USD && macroBias!=='RISK_OFF'?'LONG':'WAIT'
  const assetBias=[
    {asset:'EUR/USD',id:'EURUSD',bias:eurBias,reason:eurBias==='SHORT'?'USD-сюжет сильнее EUR, пара уязвима к снижению.':eurBias==='LONG'?'EUR-драйвер сильнее USD, допускается long-сценарий.':'Нет чистого преимущества, нужен катализатор.',trigger:'USD/EUR новость + закрепление после первой реакции',risk:'возврат в диапазон и отсутствие продолжения'},
    {asset:'GBP/USD',id:'GBPUSD',bias:gbpBias,reason:gbpBias==='SHORT'?'GBP уязвим при сильном USD.':gbpBias==='LONG'?'GBP получает локальный драйвер.':'Ждать подтверждения от EUR/USD.',trigger:'GBP и EUR синхронно двигаются против USD',risk:'GBP расходится с EUR или быстро возвращается'},
    {asset:'XAU/USD',id:'XAUUSD',bias:xauBias,reason:xauBias==='SHORT'?'Рост USD/yields давит на золото.':xauBias==='LONG'?'Risk-off или падение yields поддерживают золото.':'Ждать реакции real yields.',trigger:'yields вниз / risk-off headline / safe haven bid',risk:'резкий рост real yields или сильный USD'},
    {asset:'NASDAQ',id:'NASDAQ',bias:idxBias,reason:idxBias==='LONG'?'Risk-on и снижение yields поддерживают tech.':idxBias==='SHORT'?'Сильный USD/yields создаёт давление на tech.':'Перед macro событием лучше ждать факта.',trigger:'мягкие данные + USD/yields вниз + bid в futures',risk:'hawkish surprise / yields up'},
    {asset:'S&P 500',id:'SP500',bias:idxBias,reason:idxBias==='LONG'?'Широкий risk-on поддерживает SPX.':idxBias==='SHORT'?'Hot inflation/Fed repricing давит на рынок.':'Нет чистого импульса.',trigger:'снижение USD/yields + рост breadth/risk sentiment',risk:'hot inflation / Fed hawkish'},
    {asset:'GER40',id:'GER40',bias:gerBias,reason:gerBias==='LONG'?'Europe/risk-on поддерживают DAX.':'Нужна реакция на ECB/EUR данные.',trigger:'мягкий ECB/EU data + risk-on в Европе',risk:'risk-off или слишком сильный EUR против экспортёров'}
  ]
  const nextCatalyst=high[0]||medium[0]||calendar[0]
  const tradeability=assetBias.map((a,i)=>({asset:a.asset,id:a.id,score:clamp(Math.round((confidence/12)+(a.bias==='WAIT'?0:1.4)+(selectedNews.length/7)+(news.filter(n=>filterNews([n],a.id).length).length/18)),3,10),bias:a.bias}))
  const headline = selected==='ALL' ? 'Главный macro read: выбираем актив только там, где есть катализатор и понятный USD/risk контекст' : `${ASSETS.find(a=>a.id===selected)?.label}: план строится от macro flow, календаря и заголовков по активу`
  const selectedBias = selected==='ALL' ? null : assetBias.find(a=>a.id===selected)
  const selectedTrade = selected==='ALL' ? null : tradeability.find(a=>a.id===selected)
  const scenarios=[
    {name:'Сначала снимают USD liquidity', prob: dollarBias==='BULLISH'?68:42, play:'Если high-impact USD событие выходит сильнее прогноза — ждать усиление USD и давление на EUR/GBP/XAU.'},
    {name:'Risk-on continuation', prob: macroBias==='RISK_ON'?66:macroBias==='EVENT_RISK'?44:52, play:'Если новости мягкие и yields падают — искать продолжение в индексах и слабость USD.'},
    {name:'Geopolitical reversal', prob: scores.GOLD>=2?61:38, play:'Если Iran/war headlines разворачиваются в деэскалацию — золото может терять safe-haven bid, индексы получают поддержку.'},
  ]
  return {
    macroBias,dollarBias,confidence,primaryAsset: selected==='ALL' ? (nextCatalyst?.country ? `${nextCatalyst.country} ${nextCatalyst.event}` : 'headline flow') : ASSETS.find(a=>a.id===selected)?.label,
    headline,
    ictNarrative:selected==='ALL'
      ? 'Смотри сначала календарь, затем USD/yields, затем новости. Сделка только там, где bias совпадает с катализатором.'
      : `${selectedBias?.bias||'WAIT'} bias. Сначала ждём реакцию на ближайший катализатор, затем подтверждение направлением USD/yields/risk sentiment.`,
    drivers:[
      high.length?`High-impact событий: ${high.length}`:'High-impact событий мало',
      `USD score: ${scores.USD}`,
      `Risk score: ${scores.RISK}`,
      nextCatalyst?`Следующий драйвер: ${nextCatalyst.country} ${nextCatalyst.event}`:'Календарь пустой',
    ],
    regime:{label: macroBias==='EVENT_RISK'?'NEWS DRIVEN':macroBias==='RISK_ON'?'RISK ON':macroBias==='RISK_OFF'?'RISK OFF':'BALANCED', meaning: macroBias==='EVENT_RISK'?'До факта меньше риска, после факта ждать закрепления.':'Приоритет реакции на USD/yields и поток заголовков.'},
    assetBias, scenarios,
    executionPlan:{
      beforeNews:'До high-impact новости не входить в середине диапазона. Работать только край ликвидности или ждать факта.',
      afterNews:'После факта: первый импульс → sweep ближайшей ликвидности → закрепление → continuation. Без закрепления сделку пропускать.',
      avoid:'Не торговать за 10 минут до важной новости, на первой свече новости и при конфликте USD/yields/risk.'
    },
    macroScore:scores,
    tradeability,
    nextCatalyst,
    selectedBias,
    selectedTrade,
    assetSetup:selected==='ALL'?null:makeSetup(selected, selectedBias, selectedTrade, nextCatalyst, macroBias, dollarBias)
  }
}
function makeSetup(assetId,biasObj,trade,nextCatalyst,macroBias,dollarBias){
  const label=ASSETS.find(a=>a.id===assetId)?.label||assetId
  const bias=biasObj?.bias||'WAIT'
  const direction=bias==='LONG'?'лонг':bias==='SHORT'?'шорт':'ожидание'
  return {
    title:`${label}: ${bias} / ${trade?.score||5}/10 tradeability`,
    poi:bias==='WAIT'?'Ждать край диапазона или новостной sweep':'Зона реакции после новости / ближайший liquidity sweep по направлению bias',
    confirmation:bias==='WAIT'?'Нет сделки без нового драйвера':'Подтверждение: импульс после факта + удержание направления USD/yields/risk sentiment',
    invalidation:bias==='WAIT'?'Если цена остаётся в середине диапазона — не торговать':'Отмена: быстрый возврат против bias после первой реакции или конфликт в USD/yields',
    tp:bias==='WAIT'?'Цели не ставить до подтверждения':'TP1 — ближайшая liquidity зона; TP2 — continuation после закрепления. Минимум RR 1:2.',
    catalyst: nextCatalyst ? `${nextCatalyst.country} ${nextCatalyst.event} · ${impactOf(nextCatalyst).toUpperCase()}` : 'Нет сильного события — работать только от headline flow',
    action:bias==='WAIT'?'WAIT. Не forcing trades.':`Искать ${direction} только после подтверждения, не по первому заголовку.`
  }
}

async function groqAnalyze(key, model, payload){
  if(!key) throw new Error('NO_KEY')
  const prompt='Ты macro trader. Верни СТРОГО JSON на русском, коротко. Не выдумывай факты. Используй только предоставленные заголовки/календарь. Поля: {"headline":"1 фраза","drivers":["4 пункта"],"ictNarrative":"3 короткие строки","scenarios":[{"name":"сценарий","prob":0-100,"play":"действие"}],"assetBias":[{"asset":"EUR/USD","id":"EURUSD","bias":"LONG/SHORT/WAIT","reason":"почему","trigger":"активация","risk":"отмена"}],"executionPlan":{"beforeNews":"до","afterNews":"после","avoid":"не торговать"}}'
  const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:model||'llama-3.1-8b-instant',temperature:.12,max_tokens:420,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(payload).slice(0,2800)}]})})
  const d=await res.json().catch(()=>({}))
  if(!res.ok || d.error) { const err=new Error('AI_TEMP_UNAVAILABLE'); err.hidden=true; throw err }
  const text=d.choices?.[0]?.message?.content||''
  const parsed=safeJson(text)
  if(!parsed) { const err=new Error('AI_PARSE_SKIPPED'); err.hidden=true; throw err }
  return parsed
}

function Loading(){return <div className="boot"><div className="sonar-bg"/><div className="sonar-core"><span/><i/><b>MD</b></div><h1>MARKET DEVILS</h1><p>сканирую macro flow · risk calendar · bias matrix</p><div className="boot-ticks"><span>MACRO RADAR</span><span>RISK EVENTS</span><span>AI CACHE</span></div><div className="loader"><i/></div></div>}
function AssetTab({asset,active,onClick,macro}){ const b=asset.id==='ALL'?macro?.macroBias:macro?.assetBias?.find(x=>x.id===asset.id)?.bias||'SCAN'; return <button onClick={onClick} className={`asset-card ${asset.className} ${active?'active':''}`}><span className="asset-icon">{asset.icon}</span><span><b>{asset.label}</b><em>{asset.name}</em></span><strong className={String(b).toLowerCase()}>{b}</strong></button> }
function MarketPulse({macro}){return <div className="pulse-grid"><div className="pulse-main"><span>Market Mode</span><b>{macro.regime?.label||macro.macroBias}</b><em>{macro.regime?.meaning}</em></div><div><span>USD Bias</span><b>{macro.dollarBias}</b><em>ключ для FX / Gold / Indices</em></div><div><span>Confidence</span><b>{macro.confidence}%</b><em>сила совпадения факторов</em></div><div><span>Focus</span><b>{macro.primaryAsset}</b><em>главный драйвер</em></div></div>}
function EventRow({e}){const im=impactOf(e); return <div className={`event ${im}`}><div className="impact-dot"/><b>{timeShort(e.date)}</b><span>{e.country}</span><p>{e.event}</p><em>{e.estimate?`прогноз ${e.estimate}`:''}</em></div>}
function NewsCard({n,selected}){const im=newsImpact(n); return <article className={`news-card ${im.toLowerCase()}`}><div><div className="news-meta"><em>{im}</em><small>{n.source||'News'}</small></div><b>{shortText(n.headline,160)}</b>{n.summary&&<p>{shortText(n.summary,210)}</p>}<strong>{ruTake(n,selected)}</strong></div><span>{n.datetime?timeShort(n.datetime*1000):'—'}</span></article>}
function BiasCard({a}){return <div className={`bias-card ${a.bias?.includes('SHORT')?'short':a.bias?.includes('LONG')?'long':'wait'}`}><div><b>{a.asset}</b><span>{a.bias}</span></div><p>{a.reason}</p><dl><dt>Активация</dt><dd>{a.trigger}</dd><dt>Отмена</dt><dd>{a.risk}</dd></dl></div>}
function ScenarioCard({s}){return <div className="scenario"><div><b>{s.name}</b><span>{s.prob}%</span></div><p>{s.play}</p><div className="prob"><i style={{width:`${clamp(s.prob||0,0,100)}%`}}/></div></div>}
function ScoreGrid({macro}){return <div className="score-grid"><div><span>Macro Score</span>{Object.entries(macro.macroScore||{}).map(([k,v])=><b key={k}>{k} <em>{v>0?'+':''}{v}</em></b>)}</div><div><span>Tradeability</span>{(macro.tradeability||[]).map(x=><b key={x.id}>{x.asset} <em>{x.score}/10</em></b>)}</div><div><span>Next Catalyst</span><strong>{macro.nextCatalyst?`${timeShort(macro.nextCatalyst.date)} · ${macro.nextCatalyst.country}`:'—'}</strong><p>{macro.nextCatalyst?.event||'Нет сильного события'}</p></div></div>}
function AssetSetup({setup,bias}){ if(!setup) return null; return <section className="panel wide asset-setup"><div className="panel-head"><h2>План по активу</h2><span>{setup.title}</span></div><div className="setup-grid"><div><b>BIAS</b><strong className={(bias?.bias||'wait').toLowerCase()}>{bias?.bias||'WAIT'}</strong><p>{bias?.reason}</p></div><div><b>Где ждать реакцию</b><p>{setup.poi}</p></div><div><b>Подтверждение</b><p>{setup.confirmation}</p></div><div><b>Инвалидация</b><p>{setup.invalidation}</p></div><div><b>Тейк-профит</b><p>{setup.tp}</p></div><div><b>Катализатор</b><p>{setup.catalyst}</p></div></div><div className="action-line">{setup.action}</div></section> }

export default function App(){
  const [selected,setSelected]=useState('ALL')
  const [news,setNews]=useState([])
  const [calendar,setCalendar]=useState([])
  const [cache,setCache]=useState(()=>{ try{return JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')}catch{return {}} })
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [updated,setUpdated]=useState(null)
  const [aiStatus,setAiStatus]=useState('локальный анализ')
  const inFlightRef=useRef(false)
  const aiBlockedUntil=useRef(0)
  const selectedRef=useRef('ALL')
  const lastAiRef=useRef({})

  useEffect(()=>{ selectedRef.current=selected },[selected])
  useEffect(()=>{ localStorage.setItem(CACHE_KEY,JSON.stringify(cache)) },[cache])

  const local=useMemo(()=>calcMacro(news,calendar,selected),[news,calendar,selected])
  const cached=cache[selected]?.data
  const macro=useMemo(()=> cached ? {...local,...cached, macroScore:local.macroScore, tradeability:local.tradeability, nextCatalyst:local.nextCatalyst, selectedBias:local.selectedBias, selectedTrade:local.selectedTrade, assetSetup:local.assetSetup} : local,[cached,local])
  const visibleNews=useMemo(()=>filterNews(news,selected),[news,selected])
  const highEvents=useMemo(()=>calendar.filter(e=>impactOf(e)!=='low').sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,14),[calendar])
  const lastAiUpdate=cache[selected]?.ts ? new Date(cache[selected].ts) : updated

  const runAi = useCallback(async(assetId, n=news, c=calendar)=>{
    if(!DEFAULT_KEYS.groq || inFlightRef.current) return
    const now=Date.now()
    if(now < aiBlockedUntil.current) return
    if(lastAiRef.current[assetId] && now-lastAiRef.current[assetId] < AI_REFRESH_MS) return
    inFlightRef.current=true; lastAiRef.current[assetId]=now; setAiStatus('AI обновляется в фоне')
    const base=calcMacro(n,c,assetId)
    const assetNews=filterNews(n,assetId).slice(0,4).map(x=>({h:shortText(x.headline,100),i:newsImpact(x)}))
    const important=c.filter(x=>impactOf(x)!=='low').slice(0,4).map(x=>({c:x.country,e:x.event,i:impactOf(x),t:x.date}))
    try{
      const ai=await groqAnalyze(DEFAULT_KEYS.groq,DEFAULT_KEYS.model,{asset:assetId, local:{macroBias:base.macroBias,dollarBias:base.dollarBias,headline:base.headline,drivers:base.drivers}, news:assetNews, calendar:important})
      setCache(prev=>({...prev,[assetId]:{ts:Date.now(),data:ai}}))
      setAiStatus('AI кэш обновлён')
    }catch(e){ aiBlockedUntil.current=Date.now()+AI_RETRY_MS; setAiStatus(cache[assetId]?'показан сохранённый анализ':'локальный анализ') }
    finally{ inFlightRef.current=false }
  },[news,calendar,cache])

  const refreshData=useCallback(async({silent=false}={})=>{
    if(!silent) setBusy(true)
    const y=window.scrollY
    try{
      const [n,c]=await Promise.all([fetchFinnhubNews(DEFAULT_KEYS.finnhub),fetchFinnhubCalendar(DEFAULT_KEYS.finnhub)])
      setNews(n); setCalendar(c); setUpdated(new Date())
      runAi(selectedRef.current,n,c)
    }catch{}
    finally{ setLoading(false); if(!silent) setBusy(false); if(silent) requestAnimationFrame(()=>window.scrollTo({top:y})) }
  },[runAi])

  useEffect(()=>{ refreshData(); const t=setInterval(()=>refreshData({silent:true}),NEWS_REFRESH_MS); return()=>clearInterval(t) },[refreshData])
  useEffect(()=>{ runAi(selected,news,calendar) },[selected,news.length,calendar.length,runAi])

  if(loading) return <Loading />
  return <div className="app">
    <header className="topbar"><div className="brand"><span>◈</span><b>MARKET DEVILS</b><em>MACRO OS · v20 stable</em></div><div className="top-status"><span>{busy?'SYNC':'LIVE'}</span><b>{updated?timeFmt(updated):'--:--:--'}</b><em>AI: {lastAiUpdate?timeFmt(lastAiUpdate):aiStatus} · next {timeFmt(nextUpdateAt())}</em><button className="mini-refresh" onClick={()=>refreshData()}>↻</button></div></header>
    <section className="hero terminal-card"><div className="hero-left"><div className="asset-tabs asset-grid">{ASSETS.map(a=><AssetTab key={a.id} asset={a} active={selected===a.id} macro={calcMacro(news,calendar,'ALL')} onClick={()=>setSelected(a.id)}/>)}</div><h1>{macro.headline}</h1><p>{macro.ictNarrative}</p><div className="driver-list">{macro.drivers?.map((d,i)=><span key={i}>{d}</span>)}</div></div><MarketPulse macro={calcMacro(news,calendar,'ALL')}/></section>
    <main className="workspace no-settings">
      {selected==='ALL' ? <>
        <section className="panel wide"><div className="panel-head"><h2>Bias Matrix — все активы</h2><span>закреплено во вкладке MARKET</span></div><div className="bias-grid">{macro.assetBias?.map((a,i)=><BiasCard key={i} a={a}/>)}</div></section>
        <section className="panel"><div className="panel-head"><h2>Macro Edge</h2><span>куда есть смысл смотреть</span></div><ScoreGrid macro={macro}/></section>
      </> : <AssetSetup setup={macro.assetSetup} bias={macro.selectedBias}/>}      
      <section className="panel"><div className="panel-head"><h2>Сценарии снятия</h2><span>что может стать первым драйвером</span></div><div className="scenario-grid">{macro.scenarios?.map((s,i)=><ScenarioCard key={i} s={s}/>)}</div></section>
      <section className="panel"><div className="panel-head"><h2>Execution Protocol</h2><span>как действовать</span></div><div className="protocol"><div><b>До новости</b><p>{macro.executionPlan?.beforeNews}</p></div><div><b>После факта</b><p>{macro.executionPlan?.afterNews}</p></div><div><b>Стоп-режим</b><p>{macro.executionPlan?.avoid}</p></div></div></section>
      <section className="panel calendar-panel"><div className="panel-head"><h2>Календарь риска</h2><span>high / medium impact</span></div><div className="event-list">{highEvents.map((e,i)=><EventRow key={i} e={e}/>)}</div></section>
      <section className="panel macro-panel"><div className="panel-head"><h2>Новости + макро поток</h2><span>{visibleNews.length} заголовков · трактовка для {ASSETS.find(a=>a.id===selected)?.label}</span></div><div className="news-stack">{visibleNews.map((n,i)=><NewsCard key={n.id||n.headline||i} n={n} selected={selected}/>)}</div></section>
    </main><footer>© Market Devils · Macro OS для intraday трейдера · не является финансовым советом</footer>
  </div>
}
