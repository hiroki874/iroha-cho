import { useEffect, useMemo, useRef, useState } from 'react'
import { enablePush, hasPushSubscription, syncPushJobs, type Notice, type PushJob } from './push'
import {
  Home, ListChecks, CalendarDays, CalendarRange, NotebookPen, Settings,
  Plus, ChevronLeft, ChevronRight, X, MoreVertical, Trash2, Pencil,
  Check, Clock3, Circle, Calendar as CalendarIcon, Bell
} from 'lucide-react'

type Page = 'home' | 'todo' | 'day' | 'month' | 'memo' | 'settings'
type ThemeColor = 'pink' | 'red' | 'blue' | 'yellow' | 'orange' | 'green'
type Task = { id: string; title: string; dueDate: string; dueTime: string; memo: string; priority: boolean; done: boolean; createdAt: number; notices?: Notice[] }
type EventItem = { id: string; title: string; date: string; start: string; end: string; memo: string; color: string; parentId?: string; recurrence?: 'weekly'; excludedDates?: string[]; seriesId?: string; occurrence?: boolean; notices?: Notice[] }
type Data = { tasks: Task[]; events: EventItem[]; memos: { home: string; other: string }; theme: ThemeColor; fontMode: 'normal' | 'ud'; dailyNotifications: { enabled: boolean; times: string[] } }

const STORAGE = 'techo-planner-v1'
const palette: Record<ThemeColor, string> = {
  pink: '#f4c7d8', red: '#f3c4c4', blue: '#c9dcf5',
  yellow: '#f5e8b8', orange: '#f5d2b7', green: '#cce6d2',
}
const eventColors = ['#f4c7d8', '#f3c4c4', '#c9dcf5', '#f5e8b8', '#f5d2b7', '#cce6d2', '#d9d2f0', '#d8d8d8']
const blankData: Data = { tasks: [], events: [], memos: { home: '', other: '' }, theme: 'pink', fontMode: 'normal', dailyNotifications: { enabled: false, times: [] } }
const uid = () => crypto.randomUUID()
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const dateText = (s: string) => s ? `${Number(s.slice(5,7))}月${Number(s.slice(8,10))}日` : '未設定'
const timeMins = (s: string) => {
  if (!s) return null
  const [h,m] = s.split(':').map(Number)
  return h * 60 + m
}
const fmtTime = (s: string) => s || '未設定'
const sortTasks = (a: Task, b: Task) => {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.dueTime.localeCompare(b.dueTime)
  if (a.dueDate) return -1
  if (b.dueDate) return 1
  return a.createdAt - b.createdAt
}

function loadData(): Data {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (!raw) return blankData
    const saved = JSON.parse(raw); return { ...blankData, ...saved, dailyNotifications: { ...blankData.dailyNotifications, ...(saved.dailyNotifications ?? {}) } }
  } catch { return blankData }
}

export default function App() {
  const [data, setData] = useState<Data>(loadData)
  const [page, setPage] = useState<Page>('home')
  const [taskForm, setTaskForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [eventForm, setEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [menuTask, setMenuTask] = useState<string | null>(null)
  const [menuEvent, setMenuEvent] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [monthPicker, setMonthPicker] = useState(false)
  const [memoPage, setMemoPage] = useState<'home'|'other'>('home')
  const [confirm, setConfirm] = useState<{ kind: 'task'|'event'; id: string } | null>(null)
  const [repeatDelete, setRepeatDelete] = useState<EventItem | null>(null)
  const [overlapCandidate, setOverlapCandidate] = useState<EventItem | null>(null)
  const [pendingEvent, setPendingEvent] = useState<EventItem | null>(null)
  const [pushReady, setPushReady] = useState(hasPushSubscription())
  const [pushMessage, setPushMessage] = useState('')

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(data)) }, [data])
  useEffect(() => {
    if (!pushReady) return
    const jobs: PushJob[] = []
    const add = (id: string, date: string, time: string, title: string, body: string) => {
      if (!date || !time) return
      const at = new Date(`${date}T${time}:00`).toISOString()
      if (Date.parse(at) > Date.now()) jobs.push({ id, at, payload: { title, body } })
    }
    data.tasks.forEach(t => (t.notices ?? []).forEach(n => add(`task-${t.id}-${n.id}`, n.date, n.time, 'いろは帳', `${t.title}の期限が近づいています`)))
    data.events.forEach(e => (e.notices ?? []).forEach(n => add(`event-${e.id}-${n.id}`, n.date, n.time, 'いろは帳', `${e.title}までもう少しです`)))
    if (data.dailyNotifications.enabled) {
      const sorted = data.tasks.filter(t => !t.done && t.priority).sort(sortTasks)
      const taskLines = sorted.slice(0, 3).map(t => `・${t.title}`).join('\n') || '・なし'
      const extra = sorted.length > 3 ? `\n他 ${sorted.length - 3} 件` : ''
      for (let day = 0; day < 90; day++) {
        const d = new Date(); d.setDate(d.getDate() + day)
        const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
        data.dailyNotifications.times.forEach((time, i) => {
          const [hh, mm] = time.split(':').map(Number); const atMin = hh * 60 + mm
          const dayEvents = displayEvents.filter(e => e.date === date).sort((a,b)=>(timeMins(a.start) ?? -1)-(timeMins(b.start) ?? -1))
          const active = dayEvents.filter(e => { const st=timeMins(e.start); const en=timeMins(e.end); return st !== null && st <= atMin && (en === null || atMin < en) }).sort((a,b)=>Number(!!b.parentId)-Number(!!a.parentId))[0]
          const upcoming = dayEvents.filter(e => (timeMins(e.start) ?? -1) > atMin)[0]
          const dailyBody = `～定時通知～\n\n-優先タスク-\n${taskLines}${extra}\n\n-今の予定-\n${active ? `・${active.title}` : '・なし'}\n\n-次の予定-\n${upcoming ? `・${upcoming.title}` : '・なし'}`
          add(`daily-${date}-${i}`, date, time, 'いろは帳', dailyBody)
        })
      }
    }
    syncPushJobs(jobs).catch(() => {})
  }, [data, pushReady])

  const go = (p: Page) => { setPage(p); setTaskForm(false); setEventForm(false); setDetailTask(null); setDetailEvent(null) }
  const updateTask = (task: Task) => setData(d => ({ ...d, tasks: d.tasks.some(t => t.id === task.id) ? d.tasks.map(t => t.id === task.id ? task : t) : [...d.tasks, task] }))
  const deleteTask = (id: string) => { setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id) })); setDetailTask(null); setMenuTask(null) }
  const updateEvent = (ev: EventItem) => setData(d => ({ ...d, events: d.events.some(e => e.id === ev.id) ? d.events.map(e => e.id === ev.id ? ev : e) : [...d.events, ev] }))
  const deleteEvent = (id: string) => { setData(d => ({ ...d, events: d.events.filter(e => e.id !== id && e.parentId !== id) })); setDetailEvent(null); setMenuEvent(null) }
  const deleteEventOccurrence = (ev: EventItem, all: boolean) => {
    const masterId = ev.seriesId ?? ev.id
    if (all) setData(d => ({ ...d, events: d.events.filter(e => e.id !== masterId) }))
    else setData(d => ({ ...d, events: d.events.map(e => e.id === masterId ? { ...e, excludedDates: [...(e.excludedDates ?? []), ev.date] } : e) }))
    setRepeatDelete(null); setConfirm(null); setDetailEvent(null)
  }

  const displayEvents = useMemo(() => {
    const result: EventItem[] = []
    const limit = new Date(); limit.setFullYear(limit.getFullYear() + 5)
    for (const ev of data.events) {
      if (!(ev.excludedDates ?? []).includes(ev.date)) result.push(ev)
      if (ev.recurrence === 'weekly') {
        const cursor = new Date(`${ev.date}T12:00:00`)
        cursor.setDate(cursor.getDate() + 7)
        while (cursor <= limit) {
          const date = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`
          if (!(ev.excludedDates ?? []).includes(date)) result.push({ ...ev, id: `${ev.id}::${date}`, date, recurrence: undefined, seriesId: ev.id, occurrence: true })
          cursor.setDate(cursor.getDate() + 7)
        }
      }
    }
    return result
  }, [data.events])

  const tasks = useMemo(() => data.tasks.filter(t => !t.done), [data.tasks])
  const priorityTasks = useMemo(() => tasks.filter(t => t.priority).sort(sortTasks), [tasks])
  const overdueTasks = useMemo(() => tasks.filter(t => !t.priority && t.dueDate && t.dueDate < todayISO()).sort(sortTasks), [tasks])
  const normalTasks = useMemo(() => tasks.filter(t => !t.priority && (!t.dueDate || t.dueDate >= todayISO())).sort(sortTasks), [tasks])
  const now = new Date()
  const nowMin = now.getHours()*60 + now.getMinutes()
  const todayEvents = displayEvents.filter(e => e.date === todayISO()).sort((a,b) => (timeMins(a.start) ?? -1) - (timeMins(b.start) ?? -1))
  const currentEvent = todayEvents.filter(e => {
    const s = timeMins(e.start); const end = timeMins(e.end)
    return s !== null && s <= nowMin && (end === null || nowMin < end)
  }).sort((a,b) => Number(!!b.parentId)-Number(!!a.parentId))[0]
  const nextEvent = todayEvents.filter(e => (timeMins(e.start) ?? -1) > nowMin).sort((a,b) => (timeMins(a.start) ?? 0)-(timeMins(b.start) ?? 0))[0]

  const openNewEvent = (date = selectedDate) => { setEditingEvent(null); setEventForm(true); setSelectedDate(date) }
  const saveEvent = (ev: EventItem) => {
    if (ev.occurrence && ev.seriesId) {
      const standalone = { ...ev, id: uid(), recurrence: undefined, seriesId: undefined, occurrence: undefined, excludedDates: undefined }
      setData(d => ({ ...d, events: [...d.events.map(x => x.id === ev.seriesId ? { ...x, excludedDates: [...(x.excludedDates ?? []), ev.date] } : x), standalone] }))
      setEventForm(false); setEditingEvent(null); return
    }
    const overlapping = data.events.find(old => old.id !== ev.id && old.date === ev.date && timeMins(old.start) !== null && timeMins(ev.start) !== null && timeMins(old.end || '23:45')! > timeMins(ev.start)! && timeMins(ev.end || '23:45')! > timeMins(old.start)!)
    if (overlapping && !ev.parentId) { setPendingEvent(ev); setOverlapCandidate(overlapping); return }
    updateEvent(ev); setEventForm(false); setEditingEvent(null)
  }
  const saveAsChild = () => {
    if (!pendingEvent || !overlapCandidate) return
    updateEvent({ ...pendingEvent, parentId: overlapCandidate.id })
    setPendingEvent(null); setOverlapCandidate(null); setEventForm(false)
  }

  return (
    <div className={`app ${data.fontMode === 'ud' ? 'font-ud' : ''}`} style={{ '--accent': palette[data.theme] } as React.CSSProperties} onClick={() => { if(menuTask) setMenuTask(null); if(menuEvent) setMenuEvent(null) }}>
      <header className="topbar">
        <span>いろは帳</span>
        <div className="top-actions"><button className="icon-button" aria-label="通知設定" onClick={() => go('settings')}><Bell size={20}/></button>{page === 'home' ? <button className="icon-button" onClick={() => go('settings')}><Settings size={21}/></button> : page === 'settings' ? <button className="icon-button" onClick={() => go('home')}><X/></button> : <span className="top-date">{page === 'day' ? dateText(selectedDate) : page === 'month' ? `${month.getFullYear()}年${month.getMonth()+1}月` : ''}</span>}</div>
      </header>
      <main className="main">
        {page === 'home' && <section className="home-page">
          <div className="welcome"><div><p className="eyebrow">MY PLANNER</p><h1>{now.getFullYear()}年{now.getMonth()+1}月{now.getDate()}日</h1></div></div>
          <div className="home-panels">
            <article className="panel"><h2>優先タスク</h2>{priorityTasks.length ? priorityTasks.slice(0,4).map(t=><button className="home-line" key={t.id} onClick={()=>setDetailTask(t)}>{t.title}<small>{t.dueDate ? dateText(t.dueDate) : '期限なし'}</small></button>) : <p className="muted">優先タスクはまだありません</p>}</article>
            <article className="panel"><h2>現在の予定</h2>{currentEvent ? <button className="home-line" onClick={()=>setDetailEvent(currentEvent)}>{currentEvent.title}<small>{currentEvent.start}〜{fmtTime(currentEvent.end)}</small></button> : <p className="muted">現在の予定はありません</p>}</article>
            <article className="panel"><h2>次の予定</h2>{nextEvent ? <button className="home-line" onClick={()=>setDetailEvent(nextEvent)}>{nextEvent.title}<small>{nextEvent.start}〜{fmtTime(nextEvent.end)}</small></button> : <p className="muted">次の予定はありません</p>}</article>
            <article className="panel memo-preview"><h2>ホーム表示用メモ</h2><p className="memo-preview-text">{memoToText(data.memos.home) || 'メモはまだありません'}</p></article>
          </div>
          <div className="quick-grid">
            <button onClick={()=>go('todo')}><ListChecks/><span>TO DOリスト</span></button>
            <button onClick={()=>go('day')}><CalendarDays/><span>予定</span></button>
            <button onClick={()=>go('month')}><CalendarRange/><span>月間予定</span></button>
            <button onClick={()=>go('memo')}><NotebookPen/><span>フリーメモ</span></button>
          </div>
        </section>}

        {page === 'todo' && <section className="page-section">
          <div className="page-heading"><h1>TO DOリスト</h1><button className="add-button" onClick={()=>{setEditingTask(null);setTaskForm(true)}}><Plus/></button></div>
          <TaskGroup title="優先" tasks={priorityTasks} onOpen={setDetailTask} onMenu={setMenuTask} menu={menuTask} onEdit={t=>{setEditingTask(t);setTaskForm(true)}} onDelete={id=>setConfirm({kind:'task',id})} onComplete={id=>setConfirm({kind:'task',id})}/>
          <TaskGroup title="期限切れ" tasks={overdueTasks} onOpen={setDetailTask} onMenu={setMenuTask} menu={menuTask} onEdit={t=>{setEditingTask(t);setTaskForm(true)}} onDelete={id=>setConfirm({kind:'task',id})} onComplete={id=>setConfirm({kind:'task',id})}/>
          <TaskGroup title="通常" tasks={normalTasks} onOpen={setDetailTask} onMenu={setMenuTask} menu={menuTask} onEdit={t=>{setEditingTask(t);setTaskForm(true)}} onDelete={id=>setConfirm({kind:'task',id})} onComplete={id=>setConfirm({kind:'task',id})}/>
          <TaskGroup title="完了" tasks={data.tasks.filter(t=>t.done)} onOpen={setDetailTask} onMenu={setMenuTask} menu={menuTask} onEdit={t=>{setEditingTask(t);setTaskForm(true)}} onDelete={id=>setConfirm({kind:'task',id})} onComplete={()=>{}} completed/>
        </section>}

        {page === 'day' && <section className="page-section">
          <div className="page-heading"><div><h1>1日の予定</h1><input className="date-inline" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}/></div><button className="add-button" onClick={()=>openNewEvent(selectedDate)}><Plus/></button></div>
          <div className="timeline">
            {Array.from({length:24},(_,h)=><div className="hour-row" key={h}><span>{h}:00</span><div className="hour-line"/></div>)}
            <div className="event-layer">
              {displayEvents.filter(e=>e.date===selectedDate).map(e=>{
                const start=timeMins(e.start) ?? 0
                const actualEnd=timeMins(e.end)
                const next=displayEvents.filter(x=>x.date===e.date && x.id!==e.id && (timeMins(x.start)??0)>start).sort((a,b)=>(timeMins(a.start)??0)-(timeMins(b.start)??0))[0]
                const end=actualEnd ?? Math.min(start+60, timeMins(next?.start ?? '') ?? start+60)
                const duration=Math.max(30,end-start)
                return <button key={e.id} className={`event-card ${e.parentId?'child-event':''}`} style={{top:`${start/60*58}px`,height:`${duration/60*58}px`,background:e.color}} onClick={()=>setDetailEvent(e)}><b>{e.title}</b><small>{e.start}〜{fmtTime(e.end)}</small></button>
              })}
            </div>
          </div>
        </section>}

        {page === 'month' && <section className="page-section">
          <div className="page-heading"><button className="month-title" onClick={()=>setMonthPicker(!monthPicker)}>{month.getFullYear()}年{month.getMonth()+1}月 <span>▾</span></button><button className="add-button" onClick={()=>openNewEvent(todayISO())}><Plus/></button></div>
          {!monthPicker ? <><div className="month-arrows"><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></button><button onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></button></div><CalendarGrid month={month} events={displayEvents} selectedDate={selectedDate} onSelect={d=>{setSelectedDate(d)}}/><h2 className="day-list-title">{dateText(selectedDate)}の予定</h2><EventList events={displayEvents.filter(e=>e.date===selectedDate)} onOpen={setDetailEvent}/></> :
            <><div className="month-picker-grid">{[-1,0,1,2,3,4].map(offset=>{const m=new Date(month.getFullYear(),month.getMonth()+offset,1);return <button key={offset} onClick={()=>{setMonth(m);setMonthPicker(false)}}><b>{m.getFullYear()}年{m.getMonth()+1}月</b><MiniCalendar month={m} events={displayEvents}/></button>})}</div><button className="today-button" onClick={()=>{setMonth(new Date(now.getFullYear(),now.getMonth(),1));setMonthPicker(false)}}>今月に戻る</button></>}
        </section>}

        {page === 'memo' && <section className="page-section memo-page">
          <div className="memo-switch"><button className="plain-arrow" onClick={()=>setMemoPage('home')}><ChevronLeft/></button><strong>{memoPage==='home'?'ホーム表示用':'その他用'}</strong><button className="plain-arrow" onClick={()=>setMemoPage('other')}><ChevronRight/></button></div>
          <MemoEditor page={memoPage} value={data.memos[memoPage]} onChange={html=>setData(d=>({...d,memos:{...d.memos,[memoPage]:html}}))}/>
        </section>}

        {page === 'settings' && <section className="page-section"><h1>設定</h1><div className="setting-block"><h2>通知</h2><p className="muted">画面を閉じていても通知を受け取るには、通知を有効にしてください。</p><button className="primary-wide" onClick={async()=>{try{await enablePush();setPushReady(true);setPushMessage('通知を有効にしました。')}catch(e){setPushMessage(e instanceof Error?e.message:'通知を有効にできませんでした。')}}}>{pushReady?'通知は有効です':'通知を有効にする'}</button>{pushMessage&&<p className="muted">{pushMessage}</p>}<div className="setting-block"><h2>定時通知</h2><label className="toggle-row"><input type="checkbox" checked={data.dailyNotifications.enabled} onChange={e=>setData(d=>({...d,dailyNotifications:{...d.dailyNotifications,enabled:e.target.checked}}))}/>毎日通知する</label><DailyTimeEditor times={data.dailyNotifications.times} onChange={times=>setData(d=>({...d,dailyNotifications:{...d.dailyNotifications,times}}))}/></div></div><div className="setting-block"><h2>アプリの色</h2><div className="swatches">{(Object.keys(palette) as ThemeColor[]).map(c=><button key={c} className={`swatch ${data.theme===c?'selected':''}`} style={{background:palette[c]}} onClick={()=>setData(d=>({...d,theme:c}))}/>)}</div></div><div className="setting-block"><h2>フォントサイズ</h2><div className="segmented"><button className={data.fontMode==='normal'?'active':''} onClick={()=>setData(d=>({...d,fontMode:'normal'}))}>通常</button><button className={data.fontMode==='ud'?'active':''} onClick={()=>setData(d=>({...d,fontMode:'ud'}))}>ユニバーサルデザイン</button></div></div><p className="muted settings-note">タスク・予定・メモはこの端末内に保存されます。通知内容は暗号化して通知サーバーに預けます。</p></section>}
      </main>

      {page !== 'settings' && <nav className="bottom-nav">{[
        {id:'home' as Page,label:'ホーム',Icon:Home},{id:'todo' as Page,label:'TO DO',Icon:ListChecks},{id:'day' as Page,label:'予定',Icon:CalendarDays},{id:'month' as Page,label:'月間予定',Icon:CalendarRange},{id:'memo' as Page,label:'メモ',Icon:NotebookPen}
      ].map(({id,label,Icon})=><button key={id} className={page===id?'nav-item active':'nav-item'} onClick={()=>go(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>}

      {taskForm && <TaskModal initial={editingTask} onClose={()=>setTaskForm(false)} onSave={t=>{updateTask(t);setTaskForm(false)}}/>}
      {eventForm && <EventModal initial={editingEvent} date={selectedDate} allowRecurrence={page==='month'} onClose={()=>setEventForm(false)} onSave={saveEvent}/>}
      {overlapCandidate && pendingEvent && <Modal title="予定の時間が重なっています" onClose={()=>{setOverlapCandidate(null);setPendingEvent(null)}}><p>「{pendingEvent.title}」を「{overlapCandidate.title}」の中に入れますか？</p><div className="modal-actions"><button onClick={()=>{updateEvent(pendingEvent);setPendingEvent(null);setOverlapCandidate(null);setEventForm(false)}}>別々に登録</button><button className="primary" onClick={saveAsChild}>中に入れる</button></div></Modal>}
      {detailTask && <Modal title={detailTask.title} onClose={()=>setDetailTask(null)}><p>{detailTask.memo||'メモなし'}</p><p className="detail-meta">期限：{detailTask.dueDate?dateText(detailTask.dueDate):'未設定'} {detailTask.dueTime}</p><p className="detail-meta">優先度：{detailTask.priority?'優先':'通常'}　{detailTask.done?'完了':'未完了'}</p><p className="detail-meta">通知：{(detailTask.notices??[]).length}件</p><div className="modal-actions"><button onClick={()=>{setEditingTask(detailTask);setDetailTask(null);setTaskForm(true)}}><Pencil size={16}/> 編集</button><button onClick={()=>setConfirm({kind:'task',id:detailTask.id})}>削除</button></div></Modal>}
      {detailEvent && <Modal title={detailEvent.title} onClose={()=>setDetailEvent(null)}><p className="detail-meta">{detailEvent.date}　{detailEvent.start}〜{fmtTime(detailEvent.end)}</p><p className="detail-meta">通知：{(detailEvent.notices??[]).length}件</p><p>{detailEvent.memo||'メモなし'}</p><div className="modal-actions"><button onClick={()=>{setEditingEvent(detailEvent);setSelectedDate(detailEvent.date);setDetailEvent(null);setEventForm(true)}}><Pencil size={16}/> 編集</button><button onClick={()=>detailEvent.recurrence==='weekly' || detailEvent.seriesId ? setRepeatDelete(detailEvent) : setConfirm({kind:'event',id:detailEvent.id})}>削除</button></div></Modal>}
      {repeatDelete && <Modal title="繰り返し予定の削除" onClose={()=>setRepeatDelete(null)}><p>どの範囲を削除しますか？</p><div className="modal-actions"><button onClick={()=>setRepeatDelete(null)}>キャンセル</button><button onClick={()=>deleteEventOccurrence(repeatDelete,false)}>この予定だけ削除</button><button className="danger" onClick={()=>deleteEventOccurrence(repeatDelete,true)}>繰り返し予定をすべて削除</button></div></Modal>}
      {confirm && <Modal title={confirm.kind==='task'?'タスクの確認':'予定の確認'} onClose={()=>setConfirm(null)}><p>{confirm.kind==='task'?'このタスクを完了または削除しますか？':'この予定を削除しますか？'}</p><div className="modal-actions"><button onClick={()=>setConfirm(null)}>キャンセル</button>{confirm.kind==='task' && <button className="primary" onClick={()=>{const t=data.tasks.find(x=>x.id===confirm.id);if(t)updateTask({...t,done:true});setConfirm(null);setDetailTask(null)}}>完了する</button>}<button className="danger" onClick={()=>{if(confirm.kind==='task')deleteTask(confirm.id);else deleteEvent(confirm.id);setConfirm(null)}}>削除</button></div></Modal>}
    </div>
  )
}

function TaskGroup({title,tasks,onOpen,onMenu,menu,onEdit,onDelete,onComplete,completed=false}:{
  title:string;tasks:Task[];onOpen:(t:Task)=>void;onMenu:(id:string|null)=>void;menu:string|null;onEdit:(t:Task)=>void;onDelete:(id:string)=>void;onComplete:(id:string)=>void;completed?:boolean
}) {
  return <section className="task-group"><h2>{title}<span>{tasks.length}</span></h2>{tasks.length===0?<p className="muted group-empty">タスクはありません</p>:tasks.map(t=><div className={`task-row ${t.done?'is-done':''}`} key={t.id}>
    <button className="check-button" onClick={()=>completed?onDelete(t.id):onComplete(t.id)} aria-label={completed?'削除':'完了'}>{completed?<Check size={18}/>:<Circle size={19}/>}</button>
    <button className="task-main" onClick={()=>onOpen(t)}><b>{t.title}</b>{t.dueDate&&<small className={t.dueDate<todayISO()&&!t.done?'overdue':''}>{dateText(t.dueDate)} {t.dueTime}</small>}</button>
    <div className="menu-wrap"><button className="icon-button small" onClick={e=>{e.stopPropagation();onMenu(menu===t.id?null:t.id)}}><MoreVertical size={19}/></button>{menu===t.id&&<div className="popup-menu" onClick={e=>e.stopPropagation()}><button onClick={()=>onEdit(t)}><Pencil size={14}/>編集</button><button onClick={()=>onDelete(t.id)}><Trash2 size={14}/>削除</button></div>}</div>
  </div>)}</section>
}

function TaskModal({initial,onClose,onSave}:{initial:Task|null;onClose:()=>void;onSave:(t:Task)=>void}) {
  const [title,setTitle]=useState(initial?.title??'')
  const [dueDate,setDueDate]=useState(initial?.dueDate??'')
  const [dueTime,setDueTime]=useState(initial?.dueTime??'')
  const [memo,setMemo]=useState(initial?.memo??'')
  const [priority,setPriority]=useState(initial?.priority??false)
  const [notices,setNotices]=useState<Notice[]>(initial?.notices??[])
  return <Modal title={initial?'タスクを編集':'タスクを追加'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(title.trim())onSave({id:initial?.id??uid(),title:title.trim(),dueDate,dueTime,memo,priority,done:initial?.done??false,createdAt:initial?.createdAt??Date.now(),notices})}}>
    <label>タイトル*<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="タスク名"/></label>
    <label>期限<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <label>時刻（任意）<input type="time" step="900" value={dueTime} onChange={e=>setDueTime(e.target.value)}/></label>
    <label>メモ<textarea rows={3} value={memo} onChange={e=>setMemo(e.target.value)} placeholder="メモ・詳細"/></label>
    <label>優先度<select value={priority?'priority':'normal'} onChange={e=>setPriority(e.target.value==='priority')}><option value="normal">通常</option><option value="priority">優先</option></select></label>
    <NoticeEditor notices={notices} onChange={setNotices}/>
    <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" type="submit">{initial?'完了':'追加'}</button></div>
  </form></Modal>
}

function EventModal({initial,date,allowRecurrence,onClose,onSave}:{initial:EventItem|null;date:string;allowRecurrence:boolean;onClose:()=>void;onSave:(e:EventItem)=>void}) {
  const [title,setTitle]=useState(initial?.title??'')
  const [eventDate,setEventDate]=useState(initial?.date??date)
  const [start,setStart]=useState(initial?.start??'08:00')
  const [end,setEnd]=useState(initial?.end??'')
  const [memo,setMemo]=useState(initial?.memo??'')
  const [color,setColor]=useState(initial?.color??eventColors[0])
  const [recurrence,setRecurrence]=useState(initial?.recurrence??'')
  const [notices,setNotices]=useState<Notice[]>(initial?.notices??[])
  return <Modal title={initial?'予定を編集':'予定を追加'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(title.trim())onSave({id:initial?.id??uid(),title:title.trim(),date:eventDate,start,end,memo,color,parentId:initial?.parentId,recurrence:initial?.recurrence ?? (recurrence==='weekly'?'weekly':undefined),excludedDates:initial?.excludedDates,seriesId:initial?.seriesId,occurrence:initial?.occurrence,notices})}}>
    <label>タイトル*<input required value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>日付<input type="date" required value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label>
    <label>開始時刻<TimePicker value={start} onChange={setStart}/></label>
    <label>終了時刻<TimePicker value={end} onChange={setEnd} allowUnset/></label>
    <label>メモ<textarea rows={3} value={memo} onChange={e=>setMemo(e.target.value)} placeholder="メモ・詳細"/></label>
    {!initial && allowRecurrence && <label>繰り返し<select value={recurrence} onChange={e=>setRecurrence(e.target.value)}><option value="">指定なし</option><option value="weekly">毎週</option></select></label>}
    <NoticeEditor notices={notices} onChange={setNotices}/>
    <label>色<div className="swatches">{eventColors.map(c=><button type="button" key={c} className={`swatch ${color===c?'selected':''}`} style={{background:c}} onClick={()=>setColor(c)}/>)}</div></label>
    <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" type="submit">{initial?'完了':'追加'}</button></div>
  </form></Modal>
}
function TimePicker({value,onChange,allowUnset=false}:{value:string;onChange:(value:string)=>void;allowUnset?:boolean}) {
  const [hour,minute]=value ? value.split(':') : ['', '00']
  return <div className="time-rolls event-time-picker">
    <select aria-label="時" value={hour} onChange={e=>onChange(e.target.value===''?'':`${e.target.value}:${minute||'00'}`)}>
      {allowUnset&&<option value="">選択しない</option>}
      {Array.from({length:24},(_,h)=>{const v=String(h).padStart(2,'0');return <option key={v} value={v}>{v}時</option>})}
    </select>
    <select aria-label="分" value={minute} disabled={!hour} onChange={e=>onChange(`${hour}:${e.target.value}`)}>
      {['00','15','30','45'].map(m=><option key={m} value={m}>{m}分</option>)}
    </select>
  </div>
}

function NoticeEditor({notices,onChange}:{notices:Notice[];onChange:(items:Notice[])=>void}) {
  const add=()=>{ if(notices.length>=3)return; onChange([...notices,{id:crypto.randomUUID(),date:todayISO(),time:'08:00'}]) }
  const patch=(id:string,part:Partial<Notice>)=>onChange(notices.map(n=>n.id===id?{...n,...part}:n))
  return <div className="notice-editor"><div className="notice-heading"><b>通知</b><small>{notices.length}/3件</small></div>{notices.map((n,i)=><div className="notice-row" key={n.id}><div className="notice-row-title">通知{i+1}<button type="button" onClick={()=>onChange(notices.filter(x=>x.id!==n.id))}>削除</button></div><input aria-label="通知日付" type="date" value={n.date} onChange={e=>patch(n.id,{date:e.target.value})}/><div className="time-rolls"><select aria-label="時" value={n.time.split(':')[0]} onChange={e=>patch(n.id,{time:`${e.target.value}:${n.time.split(':')[1]}`})}>{Array.from({length:24},(_,h)=><option key={h} value={String(h).padStart(2,'0')}>{String(h).padStart(2,'0')}時</option>)}</select><select aria-label="分" value={n.time.split(':')[1]} onChange={e=>patch(n.id,{time:`${n.time.split(':')[0]}:${e.target.value}`})}>{['00','05','10','15','20','25','30','35','40','45','50','55'].map(m=><option key={m} value={m}>{m}分</option>)}</select></div></div>)}{notices.length<3&&<button className="add-notice" type="button" onClick={add}>＋ 通知を追加</button>}</div>
}
function DailyTimeEditor({times,onChange}:{times:string[];onChange:(items:string[])=>void}) {
  return <div className="daily-times">{times.map((time,i)=><div className="daily-time-row" key={i}><b>通知{i+1}</b><div className="time-rolls"><select value={time.split(':')[0]} onChange={e=>onChange(times.map((t,j)=>j===i?`${e.target.value}:${t.split(':')[1]}`:t))}>{Array.from({length:24},(_,h)=><option key={h} value={String(h).padStart(2,'0')}>{String(h).padStart(2,'0')}時</option>)}</select><select value={time.split(':')[1]} onChange={e=>onChange(times.map((t,j)=>j===i?`${t.split(':')[0]}:${e.target.value}`:t))}>{['00','05','10','15','20','25','30','35','40','45','50','55'].map(m=><option key={m} value={m}>{m}分</option>)}</select></div><button onClick={()=>onChange(times.filter((_,j)=>j!==i))}>削除</button></div>)}{times.length<3&&<button className="add-notice" onClick={()=>onChange([...times,'08:00'])}>＋ 時刻を追加</button>}</div>
}
function MemoEditor({page,value,onChange}:{page:'home'|'other';value:string;onChange:(html:string)=>void}) {
  const editorRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (editorRef.current) editorRef.current.innerHTML = memoToHtml(value) }, [page])
  return <div ref={editorRef} className="memo-editor" contentEditable suppressContentEditableWarning style={{color:'#222222',whiteSpace:'pre-wrap',outline:'none'}} data-placeholder="自由にメモを書こう" onInput={e=>onChange((e.currentTarget as HTMLDivElement).innerHTML)}/>
}

function memoToHtml(value:string){ if(!value) return ''; if(value.includes('<') && value.includes('>')) return value; return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') }
function memoToText(value:string){ if(!value) return ''; const el=document.createElement('div'); el.innerHTML=memoToHtml(value); return el.textContent ?? '' }
function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><b>{title}</b><button className="icon-button" onClick={onClose}><X/></button></div>{children}</div></div>}
function EventList({events,onOpen}:{events:EventItem[];onOpen:(e:EventItem)=>void}){return <div className="event-list">{events.length?events.sort((a,b)=>a.start.localeCompare(b.start)).map(e=><button key={e.id} onClick={()=>onOpen(e)}><i style={{background:e.color}}/><span>{e.title}<small>{e.start}〜{fmtTime(e.end)}</small></span></button>):<p className="muted">この日の予定はありません</p>}</div>}
function CalendarGrid({month,events,selectedDate,onSelect}:{month:Date;events:EventItem[];selectedDate:string;onSelect:(s:string)=>void}) {
  const first=new Date(month.getFullYear(),month.getMonth(),1).getDay()
  const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate()
  return <div className="calendar-grid">{['日','月','火','水','木','金','土'].map(d=><b className="weekday" key={d}>{d}</b>)}{Array.from({length:first},(_,i)=><span key={`blank${i}`}/>)}{Array.from({length:count},(_,i)=>{const d=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;const es=events.filter(e=>e.date===d);return <button key={d} className={selectedDate===d?'selected-day':''} onClick={()=>onSelect(d)}><span>{i+1}</span>{es.slice(0,3).map(e=><i key={e.id} style={{background:e.color}}/>)}{es.length>3&&<small>+{es.length-3}</small>}</button>})}</div>
}
function MiniCalendar({month,events}:{month:Date;events:EventItem[]}){const first=new Date(month.getFullYear(),month.getMonth(),1).getDay();const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();return <div className="mini-grid">{Array.from({length:first},(_,i)=><span key={`b${i}`}/>)}{Array.from({length:count},(_,i)=>{const d=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;return <span key={d} className={events.some(e=>e.date===d)?'has-event':''}>{i+1}</span>})}</div>}
