// Einfaches Datenmodell + LocalStorage
const STORAGE_KEY = 'wochenplaner:v1'

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

function load(){
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : {tasks:[], todos:[]}
}

function save(db){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

const db = load()

// Model helpers
function createTask({title,type,details,due,color,scope,recurringDaily}){
  const t = {id:uid(),title,type,details,created: new Date().toISOString(),color: color || null,todoIds:[],done:false,completedDates:[],exclusions:[]}
  // store scope and relevant date fields
  t.scope = scope || 'date'
  t.recurringDaily = !!recurringDaily
  if(t.scope === 'date') t.due = due || null
  else if(t.scope === 'week') t.dueWeek = due || null
  else if(t.scope === 'month') t.dueMonth = due || null
  else if(t.scope === 'year') t.dueYear = due || null
  db.tasks.push(t); save(db); render()
  return t
}

function toggleTaskDone(taskId){
  const t = db.tasks.find(x=>x.id===taskId); if(!t) return
  // For recurring tasks, toggle completion for a specific date (today by default)
  if(t.recurringDaily){
    const key = getDateKey(new Date())
    t.completedDates = t.completedDates || []
    const idx = t.completedDates.indexOf(key)
    if(idx === -1) t.completedDates.push(key)
    else t.completedDates.splice(idx,1)
    save(db); render(); return
  }
  t.done = !t.done
  save(db); render()
}

function getDateKey(d){
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}

function isTaskDoneOnDate(task, date){
  if(!task) return false
  if(task.recurringDaily){
    const key = getDateKey(date)
    return Array.isArray(task.completedDates) && task.completedDates.includes(key)
  }
  return !!task.done
}

function isTaskExcludedOnDate(task, date){
  if(!task) return false
  if(Array.isArray(task.exclusions) && task.exclusions.length){
    const key = getDateKey(date)
    return task.exclusions.includes(key)
  }
  return false
}

function createTodo(title, linkedTaskId){
  const todo = {id:uid(),title,done:false,linkedTaskId: linkedTaskId||null}
  db.todos.push(todo); if(linkedTaskId){
    const task = db.tasks.find(x=>x.id===linkedTaskId); if(task) task.todoIds.push(todo.id)
  }
  save(db); render()
  return todo
}

function deleteTodo(id){
  // remove from todos array
  const idx = db.todos.findIndex(t=>t.id===id)
  if(idx === -1) return
  const todo = db.todos[idx]
  // remove reference from linked task if present
  if(todo.linkedTaskId){
    const task = db.tasks.find(t=>t.id===todo.linkedTaskId)
    if(task) task.todoIds = task.todoIds.filter(x=>x!==id)
  }
  db.todos.splice(idx,1)
  save(db)
  render()
}

function toggleTodo(id){
  const t = db.todos.find(x=>x.id===id); if(!t) return; t.done = !t.done; save(db); render()
}

function computeProgress(task){
  if(!task.todoIds.length) return 0
  const todos = task.todoIds.map(id=>db.todos.find(t=>t.id===id)).filter(Boolean)
  const done = todos.filter(t=>t.done).length
  return Math.round((done / todos.length)*100)
}

// Rendering
const notesList = document.getElementById('notes-list')
const todoList = document.getElementById('todo-list')
const todoLink = document.getElementById('todo-link')
const calendarGrid = document.getElementById('calendar-grid')
const monthYearLabel = document.getElementById('month-year')
const prevMonthBtn = document.getElementById('prev-month')
const nextMonthBtn = document.getElementById('next-month')

let viewDate = new Date()

function changeMonth(offset){
  viewDate.setMonth(viewDate.getMonth()+offset)
  render()
}

if(prevMonthBtn) prevMonthBtn.onclick = ()=> changeMonth(-1)
if(nextMonthBtn) nextMonthBtn.onclick = ()=> changeMonth(1)

function render(){
  renderCalendar()
  renderLegend()
  renderWeekProgress()

  // notes grouped by week: first block = current week (include month/year of current month/year),
  // subsequent blocks = next weeks (only date/week scoped tasks)
  notesList.innerHTML = ''
  const pending = db.tasks.filter(t=>!t.done)
  // sort by effective date proximity to today (closest/most current first)
  const today = new Date()
  function isoWeekToDate(weekStr){
    if(!weekStr) return null
    const m = weekStr.match(/(\d{4})-W(\d{2})/)
    if(!m) return null
    const y = parseInt(m[1],10), w = parseInt(m[2],10)
    const jan4 = new Date(Date.UTC(y,0,4))
    const day = jan4.getUTCDay() || 7
    const monday = new Date(Date.UTC(y,0,4))
    monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (w - 1) * 7)
    monday.setUTCHours(0,0,0,0)
    return monday
  }
  function getTaskEffectiveDate(t){
    if(!t) return null
    if(t.recurringDaily) return new Date()
    try{
      if(!t.scope || t.scope === 'date'){
        if(t.due) return new Date(t.due + 'T00:00:00')
      }
      if(t.scope === 'week' && t.dueWeek) return isoWeekToDate(t.dueWeek)
      if(t.scope === 'month' && t.dueMonth) return new Date(t.dueMonth + '-01T00:00:00')
      if(t.scope === 'year' && t.dueYear) return new Date(String(t.dueYear) + '-01-01T00:00:00')
      if(t.created) return new Date(t.created)
    } catch(e){ /* fallthrough */ }
    return null
  }
  function compareByProximity(a,b){
    const da = getTaskEffectiveDate(a)
    const dbt = getTaskEffectiveDate(b)
    if(!da && !dbt) return 0
    if(!da) return 1
    if(!dbt) return -1
    const diffA = Math.abs(da - today)
    const diffB = Math.abs(dbt - today)
    return diffA - diffB
  }
  pending.sort(compareByProximity)
  const currWeekStart = getWeekRange(today).start
  const currMonthKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
  const currYear = String(today.getFullYear())
  const assigned = new Set()
  // render only the first two week blocks as special blocks
  const maxRenderWeeks = 2
  for(let wi=0; wi<maxRenderWeeks; wi++){
    const weekStart = new Date(currWeekStart); weekStart.setDate(currWeekStart.getDate() + wi*7)
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6); weekEnd.setHours(23,59,59,999)
    let tasksForWeek = []
    if(wi === 0){
      tasksForWeek = pending.filter(t=>{
        if(assigned.has(t.id)) return false
        if(t.recurringDaily) return true
        if(t.scope === 'month' && t.dueMonth === currMonthKey) return true
        if(t.scope === 'year' && String(t.dueYear) === currYear) return true
        return taskMatchesInWeek(t, weekStart, weekEnd)
      })
    } else {
      tasksForWeek = pending.filter(t=>{
        if(assigned.has(t.id)) return false
        // avoid placing month/year scoped tasks in later week blocks
        if(t.scope === 'month' || t.scope === 'year') return false
        return taskMatchesInWeek(t, weekStart, weekEnd)
      })
    }
    if(tasksForWeek.length){
      const block = document.createElement('div'); block.className = 'notes-week-block'
      const hdr = document.createElement('div'); hdr.className = 'notes-week-header'
      hdr.textContent = (wi === 0) ? 'This Week' : (wi === 1 ? 'Next Week' : `${weekStart.toLocaleDateString()} — ${weekEnd.toLocaleDateString()}`)
      block.appendChild(hdr)
      // sort tasks within the week by proximity to today (most current first)
      tasksForWeek.sort(compareByProximity)
      const inner = document.createElement('div'); inner.className = 'notes-week-items'
      for(const t of tasksForWeek){
        assigned.add(t.id)
        const el = document.createElement('div'); el.className='note'
        const dispDate = t.scope === 'date' ? t.due : t.scope === 'week' ? t.dueWeek : t.scope === 'month' ? t.dueMonth : t.scope === 'year' ? t.dueYear : null
        const rec = t.recurringDaily ? ' • täglich' : ''
        el.innerHTML = `<strong>${escapeHtml(t.title)}</strong><div class="meta">${t.type} ${dispDate? '• '+dispDate : ''}${rec}</div><div class="meta">Fortschritt: ${computeProgress(t)}%</div>`
        if(t.color){ el.style.borderLeft = `6px solid ${t.color}` }
        else {
          if(t.type === 'day') el.style.borderLeft = '6px solid #2b82ff'
          if(t.type === 'week') el.style.borderLeft = '6px solid #a78bfa'
          if(t.type === 'month') el.style.borderLeft = '6px solid #facc15'
        }
        el.onclick = ()=> openDetails(t.id)
        inner.appendChild(el)
      }
      block.appendChild(inner)
      notesList.appendChild(block)
    }
    if(assigned.size >= pending.length) break
  }

  // remaining (unassigned) pending tasks -> render in a two-column grid under "Weitere Aufgaben"
  const remaining = pending.filter(t => !assigned.has(t.id))
  // sort remaining by proximity too
  remaining.sort(compareByProximity)
  if(remaining.length){
    const moreBlock = document.createElement('div'); moreBlock.className = 'notes-more-block'
    const moreHdr = document.createElement('div'); moreHdr.className = 'notes-week-header'; moreHdr.textContent = 'More Tasks'
    moreBlock.appendChild(moreHdr)
    const grid = document.createElement('div'); grid.className = 'notes-more-grid'
    for(const t of remaining){
      const el = document.createElement('div'); el.className='note'
      const dispDate = t.scope === 'date' ? t.due : t.scope === 'week' ? t.dueWeek : t.scope === 'month' ? t.dueMonth : t.scope === 'year' ? t.dueYear : null
      const rec = t.recurringDaily ? ' • täglich' : ''
      el.innerHTML = `<strong>${escapeHtml(t.title)}</strong><div class="meta">${t.type} ${dispDate? '• '+dispDate : ''}${rec}</div><div class="meta">Fortschritt: ${computeProgress(t)}%</div>`
      if(t.color){ el.style.borderLeft = `6px solid ${t.color}` }
      else {
        if(t.type === 'day') el.style.borderLeft = '6px solid #2b82ff'
        if(t.type === 'week') el.style.borderLeft = '6px solid #a78bfa'
        if(t.type === 'month') el.style.borderLeft = '6px solid #facc15'
      }
      el.onclick = ()=> openDetails(t.id)
      grid.appendChild(el)
    }
    moreBlock.appendChild(grid)
    notesList.appendChild(moreBlock)
  }

  // todos
  todoList.innerHTML=''
  for(const td of db.todos){
    const row = document.createElement('div'); row.className='todo'
    const label = document.createElement('label')
    label.innerHTML = `<input type="checkbox" ${td.done? 'checked':''} data-id="${td.id}" /> ${escapeHtml(td.title)}`
    const meta = document.createElement('small'); meta.textContent = td.linkedTaskId? (db.tasks.find(x=>x.id===td.linkedTaskId)||{}).title : ''
    const del = document.createElement('button'); del.className='del-btn'; del.textContent = '✕'; del.title = 'Löschen'; del.onclick = (e)=>{ e.stopPropagation(); deleteTodo(td.id) }
    const cb = label.querySelector('input[type=checkbox]'); cb.onchange = ()=> toggleTodo(td.id)
    row.appendChild(label); row.appendChild(meta); row.appendChild(del)
    todoList.appendChild(row)
  }

  // todo link select: only show active (not done) tasks
  todoLink.innerHTML = '<option value="">(nicht verlinken)</option>'
  const activeTasks = db.tasks.filter(t => !t.done)
  for(const t of activeTasks){
    const opt = document.createElement('option'); opt.value=t.id; opt.textContent = t.title; todoLink.appendChild(opt)
  }

  // completed tasks list at bottom
  const completedRoot = document.getElementById('completed-list')
  if(completedRoot){
    completedRoot.innerHTML = ''
    // show only tasks that are globally completed (non-recurring tasks with done=true)
    const completed = db.tasks.filter(t=> !t.recurringDaily && t.done)
    for(const t of completed){
      const el = document.createElement('div'); el.className = 'completed-item'
      const dispDate = t.scope === 'date' ? t.due : t.scope === 'week' ? t.dueWeek : t.scope === 'month' ? t.dueMonth : t.scope === 'year' ? t.dueYear : null
      el.innerHTML = `<strong>${escapeHtml(t.title)}</strong><div class="meta">${t.type} ${dispDate? '• '+dispDate : ''}</div>`
      el.onclick = ()=> openDetails(t.id)
      const undo = document.createElement('button'); undo.className = 'undo-btn'; undo.innerHTML = '↺'; undo.title = 'Undo'; undo.onclick = (e)=>{ e.stopPropagation(); toggleTaskDone(t.id) }
      el.appendChild(undo)
      completedRoot.appendChild(el)
    }
  }
}

function getWeekRange(date){
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7 // 0=Mon
  const start = new Date(d); start.setDate(d.getDate() - day); start.setHours(0,0,0,0)
  const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
  return {start,end}
}

function inRangeDateStr(dateStr, start, end){
  if(!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  return d >= start && d <= end
}

// helpers for week/month/year matching
function dateToWeekString(date){
  // ISO week string YYYY-Www
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1))
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1)/7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`
}

function matchesTaskOnDate(task, date){
  if(!task) return false
  // respect per-date exclusions for recurring tasks
  if(isTaskExcludedOnDate(task, date)) return false
  if(task.recurringDaily) return true
  const y = date.getFullYear()
  const m = String(date.getMonth()+1).padStart(2,'0')
  const d = String(date.getDate()).padStart(2,'0')
  const dateStr = `${y}-${m}-${d}`
  if(!task.scope || task.scope === 'date') return task.due === dateStr
  if(task.scope === 'week'){
    const wk = dateToWeekString(date)
    return task.dueWeek === wk
  }
  if(task.scope === 'month'){
    const mo = `${y}-${m}`
    return task.dueMonth === mo
  }
  if(task.scope === 'year'){
    return String(task.dueYear) === String(y)
  }
  return false
}

function taskMatchesInWeek(task, start, end){
  if(!task) return false
  // if task is excluded for this week (all days) then false
  // check any exclusion inside week range
  if(Array.isArray(task.exclusions) && task.exclusions.length){
    const hasExclusionInWeek = task.exclusions.some(dstr=> inRangeDateStr(dstr, start, end))
    if(hasExclusionInWeek && task.recurringDaily) return false
  }
  if(task.recurringDaily) return true
  if(!task.scope || task.scope === 'date'){
    return task.due && inRangeDateStr(task.due, start, end)
  }
  if(task.scope === 'week'){
    // check if task's week equals week's start
    const wk = dateToWeekString(start)
    return task.dueWeek === wk
  }
  if(task.scope === 'month'){
    // include if month equals start month
    const ym = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}`
    return task.dueMonth === ym
  }
  if(task.scope === 'year'){
    return String(task.dueYear) === String(start.getFullYear())
  }
  return false
}

function renderWeekProgress(){
  const label = document.getElementById('week-label')
  const rangeEl = document.getElementById('week-range')
  const {start,end} = getWeekRange(new Date())
  const weekNum = (()=>{
    const tmp = new Date(start); tmp.setHours(0,0,0,0)
    const firstJan = new Date(tmp.getFullYear(),0,1)
    const days = Math.floor((tmp - firstJan) / (24*60*60*1000))
    return Math.ceil((days + ((firstJan.getDay()+6)%7) + 1) / 7)
  })()
  if(label) label.textContent = `Week ${weekNum}`
  if(rangeEl) rangeEl.textContent = `${start.toLocaleDateString()} — ${end.toLocaleDateString()}`

  const types = ['day','week','month','year']
  for(const type of types){
    // select tasks matching this week for the given type
    const tasks = db.tasks.filter(t=> t.type === type && taskMatchesInWeek(t, start, end))
    let pct = 0
    if(tasks.length){
      const sum = tasks.reduce((s,t)=> s + computeProgress(t), 0)
      pct = Math.round(sum / tasks.length)
    }
    const bar = document.getElementById('bar-'+type)
    const pctEl = document.getElementById('pct-'+type)
    if(bar) bar.style.width = pct + '%'
    if(pctEl) pctEl.textContent = pct + '%'
    // if year-type and color chosen, use first task color
    if(type === 'year' && tasks.length){
      const col = tasks.find(t=>t.color && t.color.length)?.color
      if(col && document.getElementById('bar-year')) document.getElementById('bar-year').style.background = col
    }
    if(type === 'month' && tasks.length){
      const col = tasks.find(t=>t.color && t.color.length)?.color || '#facc15'
      if(col && document.getElementById('bar-month')) document.getElementById('bar-month').style.background = col
    }
    if(type === 'week' && tasks.length){
      const col = tasks.find(t=>t.color && t.color.length)?.color
      if(col && document.getElementById('bar-week')) document.getElementById('bar-week').style.background = col
    }
  }
}

// render legend (updates sample swatches if needed)
function renderLegend(){
  const legend = document.getElementById('legend')
  if(!legend) return
  // samples already inline in HTML, but ensure contrast text if needed — keep minimal
}

// update color preview (simple sample only)
const yearColorSelect = document.getElementById('year-color')
const colorSample = document.getElementById('color-sample')
if(yearColorSelect){
  function updateColorPreview(){
    const hex = yearColorSelect.value
    if(colorSample) colorSample.style.background = hex
  }
  yearColorSelect.addEventListener('change', updateColorPreview)
  // init
  updateColorPreview()
}

// set year event background (no contrast logic)
function colorizeYearEventElement(el, color){
  if(!color) return
  el.style.background = color
}

function getContrastColor(hex){
  if(!hex) return '#fff'
  const h = hex.replace('#','')
  if(h.length !== 6) return '#fff'
  const r = parseInt(h.substring(0,2),16)
  const g = parseInt(h.substring(2,4),16)
  const b = parseInt(h.substring(4,6),16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 150 ? '#111' : '#fff'
}

function formatMonthYear(d){
  return d.toLocaleString('en-US',{month:'long',year:'numeric'})
}

function renderCalendar(){
  if(!calendarGrid) return
  calendarGrid.innerHTML = ''
  monthYearLabel.textContent = formatMonthYear(viewDate)
  // Ensure month label is not clickable (year overview shown separately)
  if(monthYearLabel){
    monthYearLabel.style.cursor = 'default'
    monthYearLabel.onclick = null
  }
  // render month-scoped task title in header
  const monthHeaderEl = document.getElementById('month-task-header')
  const monthKey = `${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`
  const monthTasks = db.tasks.filter(t=> t.scope === 'month' && t.dueMonth === monthKey)
  if(monthHeaderEl){
    if(monthTasks.length){
      monthHeaderEl.textContent = monthTasks.map(t=>t.title).join(' — ')
      const col = monthTasks.find(t=>t.color && t.color.length)?.color
      if(col){ monthHeaderEl.style.background = col; monthHeaderEl.style.color = getContrastColor(col) } else { monthHeaderEl.style.background = ''; monthHeaderEl.style.color = '' }
      monthHeaderEl.onclick = ()=>{ if(monthTasks[0] && monthTasks[0].id) openDetails(monthTasks[0].id) }
    } else {
      monthHeaderEl.textContent = ''
      monthHeaderEl.style.background = ''
      monthHeaderEl.style.color = ''
      monthHeaderEl.onclick = null
    }
  }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  // first day of month and how many blank before (ISO week starts Mon)
  const first = new Date(year, month, 1)
  let startWeekday = first.getDay() // 0=Sun
  // convert to Mon=0..Sun=6
  startWeekday = (startWeekday + 6) % 7

  const daysInMonth = new Date(year, month+1, 0).getDate()
  const totalCells = startWeekday + daysInMonth
  const weeks = Math.ceil(totalCells / 7)

  for(let w = 0; w < weeks; w++){
    // compute the Monday that starts this calendar row
    const weekStart = new Date(year, month, 1 - startWeekday + w*7)
    const weekId = dateToWeekString(weekStart)
    // find week-scoped tasks for this week
    const weekTasks = db.tasks.filter(t => t.scope === 'week' && t.dueWeek === weekId)
    if(weekTasks.length){
      const header = document.createElement('div'); header.className = 'week-header'
      header.textContent = weekTasks.map(t=>t.title).join(' — ')
      // apply color from first week task if present
      const col = weekTasks.find(t=>t.color && t.color.length)?.color
      if(col){ header.style.background = col; header.style.color = getContrastColor(col) }
      // clickable to open first task
      header.addEventListener('click', ()=>{ if(weekTasks[0] && weekTasks[0].id) openDetails(weekTasks[0].id) })
      calendarGrid.appendChild(header)
    }

    // create 7 day cells for this week row
    for(let i=0;i<7;i++){
      const dayIndex = 1 - startWeekday + w*7 + i
      if(dayIndex < 1 || dayIndex > daysInMonth){
        const el = document.createElement('div'); el.className='day empty'; calendarGrid.appendChild(el); continue
      }
      const d = dayIndex
      const cellDate = new Date(year, month, d)
      const cell = document.createElement('div'); cell.className='day'
      const dateEl = document.createElement('div'); dateEl.className='date'; dateEl.textContent = d
      cell.appendChild(dateEl)
      const eventsEl = document.createElement('div'); eventsEl.className='events'

      // show events except week- and month-scoped (they are rendered as headers)
      const tasksForDay = db.tasks.filter(t=> matchesTaskOnDate(t, cellDate) && t.scope !== 'week' && t.scope !== 'month')
      for(const t of tasksForDay){
        const ev = document.createElement('div'); ev.className='cal-event small'
        ev.textContent = t.title
        if(isTaskDoneOnDate(t, cellDate)) ev.classList.add('done')
        if(t.type === 'day') ev.classList.add('day-type')
        else if(t.type === 'week') ev.classList.add('week-type')
        else if(t.type === 'month') ev.classList.add('month-type')
        else if(t.type === 'year') ev.classList.add('year-type')
        // if the task specifies a color and isn't done, use it for the event
        if(t.color && !isTaskDoneOnDate(t, cellDate)){ ev.style.background = t.color; ev.style.color = getContrastColor(t.color) }
        ev.onclick = (e)=>{ e.stopPropagation(); openDetails(t.id) }
        eventsEl.appendChild(ev)
      }

      // highlight cells covered by month/year scopes; week highlighting done via header
      const coverTypes = new Set()
      for(const t of db.tasks){
        if(!t.scope) continue
        if(t.scope === 'month' && matchesTaskOnDate(t, cellDate)) coverTypes.add('month')
        if(t.scope === 'year' && matchesTaskOnDate(t, cellDate)) coverTypes.add('year')
      }
      if(coverTypes.has('month')) cell.classList.add('covered-month')
      if(coverTypes.has('year')) cell.classList.add('covered-year')

      // if this week has weekTasks, mark the days as covered-week
      if(weekTasks.length) cell.classList.add('covered-week')

      cell.appendChild(eventsEl)
      calendarGrid.appendChild(cell)
    }
  }
}

// year overview removed

function openDetails(taskId){
  const task = db.tasks.find(t=>t.id===taskId); if(!task) return
  showModalFor(task)
}

// Simple modal form handling
const modal = document.getElementById('modal')
const btnNew = document.getElementById('btn-new')
const btnExport = document.getElementById('btn-export')
const modalClose = document.getElementById('modal-close')
const taskForm = document.getElementById('task-form')
const taskTodos = document.getElementById('task-todos')
const taskDeleteBtn = document.getElementById('task-delete')

if(btnNew) btnNew.onclick = ()=> showModalFor()
if(modalClose) modalClose.onclick = ()=> closeModal()
if(btnExport) btnExport.onclick = ()=> exportAllAsICS()

// scope inputs are controlled by the selected `type` (see type change handler)

function showModalFor(task){
  modal.classList.remove('hidden')
  document.getElementById('title').value = task? task.title : ''
  document.getElementById('type').value = task? task.type : 'day'
  // show the correct scope input depending on the task type
  const typeVal = task ? task.type : (document.getElementById('type')?.value || 'day')
  const allScopeEls = document.querySelectorAll('.scope-input')
  allScopeEls.forEach(el=> el.classList.add('hidden'))
  // remove required from all scope inputs, then enable required for the visible one
  allScopeEls.forEach(el=>{ const inp = el.querySelector('input'); if(inp) inp.required = false })
    const scopeKey = (typeVal === 'day') ? 'date' : typeVal
    // Only show the date input to the user; other scope values are handled in background
    const scEl = document.querySelector('.scope-input[data-scope="date"]')
    // hide all and only show date input
    document.querySelectorAll('.scope-input').forEach(el=> el.classList.add('hidden'))
    if(scEl){ scEl.classList.remove('hidden'); const inp = scEl.querySelector('input'); if(inp) inp.required = true }
    const today = new Date().toISOString().slice(0,10)
    // set visible date input: existing task date or today for new day tasks
    document.getElementById('due-day').value = (task && task.due) ? task.due : ((!task && scopeKey === 'date') ? today : '')
  document.getElementById('due-week').value = task && task.dueWeek ? task.dueWeek : ''
  document.getElementById('due-month').value = task && task.dueMonth ? task.dueMonth : ''
  document.getElementById('due-year').value = task && task.dueYear ? task.dueYear : ''
  document.getElementById('rec-daily').checked = task && task.recurringDaily ? true : false
  document.getElementById('details').value = task? task.details : ''
  document.getElementById('modal-title').textContent = task? 'Aufgabe bearbeiten' : 'Neue Aufgabe'
  // make save button full-width when editing an existing task
  const submitBtn = taskForm ? taskForm.querySelector('button[type="submit"]') : null
  if(submitBtn){
    // apply full-width style both when creating and editing
    submitBtn.classList.add('submit-fullwidth')
  }
  taskTodos.innerHTML = ''
  // year color control visibility
  const colorWrap = document.getElementById('year-color-wrap')
  const colorSelect = document.getElementById('year-color')
  // show color control for year and week types
  if(task && (task.type === 'year' || task.type === 'week')){
    colorWrap.classList.remove('hidden')
    if(task.color) colorSelect.value = task.color
  } else if(!task && document.getElementById('type')?.value === 'week'){
    colorWrap.classList.remove('hidden')
    colorSelect.value = '#a78bfa'
  } else {
    colorWrap.classList.add('hidden')
    colorSelect.value = '#fde68a'
  }
  if(task){
    document.getElementById('task-details').classList.remove('hidden')
    for(const id of task.todoIds){
      const td = db.todos.find(x=>x.id===id); if(!td) continue
      const li = document.createElement('li'); li.textContent = td.title + (td.done? ' ✅':'')
      taskTodos.appendChild(li)
    }
  } else {
    document.getElementById('task-details').classList.add('hidden')
  }
  modal.dataset.taskId = task? task.id : ''
  // show/hide delete and done buttons in modal
  const taskDoneBtn = document.getElementById('task-done')
    if(task){
    taskDeleteBtn.classList.remove('hidden'); taskDeleteBtn.onclick = ()=> deleteTask(task.id)
    if(taskDoneBtn){
      taskDoneBtn.classList.remove('hidden')
      if(task.done){ taskDoneBtn.innerHTML = '↺'; taskDoneBtn.title = 'Undo' }
      else { taskDoneBtn.textContent = 'Done'; taskDoneBtn.title = 'Done' }
      taskDoneBtn.onclick = (e)=>{ e.stopPropagation();
        // for recurring tasks, toggle done for the date shown in the date input (or today)
        const dateInput = document.getElementById('due-day')
        let targetDate = null
        if(dateInput && dateInput.value) targetDate = new Date(dateInput.value + 'T00:00:00')
        else targetDate = new Date()
        if(task.recurringDaily){
          const key = getDateKey(targetDate)
          task.completedDates = task.completedDates || []
          const idx = task.completedDates.indexOf(key)
          if(idx === -1) task.completedDates.push(key)
          else task.completedDates.splice(idx,1)
          save(db); render(); closeModal(); return
        }
        toggleTaskDone(task.id); closeModal()
      }
    }
  } else {
    taskDeleteBtn.classList.add('hidden'); taskDeleteBtn.onclick = null
    if(taskDoneBtn){ taskDoneBtn.classList.add('hidden'); taskDoneBtn.onclick = null }
  }
}

function closeModal(){ modal.classList.add('hidden'); modal.dataset.taskId = '' }

function deleteTask(taskId){
  if(!taskId) return
  // if task is recurring and the repeat checkbox is NOT checked, only remove today's instance
  const task = db.tasks.find(t=>t.id===taskId)
  if(task && task.recurringDaily){
    const recBox = document.getElementById('rec-daily')
    if(recBox && !recBox.checked){
      if(!confirm('Remove only today\'s instance of this recurring task?')) return
      const key = getDateKey(new Date())
      task.exclusions = task.exclusions || []
      if(!task.exclusions.includes(key)) task.exclusions.push(key)
      save(db); closeModal(); render(); return
    }
  }
  if(!confirm('Delete task and all associated to-dos?')) return
  // remove task
  const tIdx = db.tasks.findIndex(t=>t.id===taskId)
  if(tIdx === -1) return
  const target = db.tasks[tIdx]
  // remove associated todos (by linkedTaskId or task.todoIds)
  const linkedIds = new Set(target.todoIds)
  for(let i = db.todos.length -1; i>=0; i--){
    const td = db.todos[i]
    if(td.linkedTaskId === taskId || linkedIds.has(td.id)) db.todos.splice(i,1)
  }
  db.tasks.splice(tIdx,1)
  save(db)
  closeModal(); render()
}

if(taskForm) taskForm.onsubmit = (e)=>{
  e.preventDefault()
  const id = modal.dataset.taskId
  const title = document.getElementById('title').value.trim()
  const type = document.getElementById('type').value
  const details = document.getElementById('details').value.trim()
  const color = document.getElementById('year-color').value
  const scope = (type === 'day') ? 'date' : type
  const recurringDaily = document.getElementById('rec-daily').checked
  let due = null
  if(scope === 'date') due = document.getElementById('due-day').value || null
  if(scope === 'week') due = document.getElementById('due-week').value || null
  if(scope === 'month') due = document.getElementById('due-month').value || null
  if(scope === 'year') due = document.getElementById('due-year').value || null
  const payload = {title,type,details,color,scope,recurringDaily,due}
  if(id){
    const task = db.tasks.find(t=>t.id===id);
    // update stored fields carefully
    task.title = payload.title; task.type = payload.type; task.details = payload.details; task.color = payload.color
    task.scope = payload.scope; task.recurringDaily = !!payload.recurringDaily
    delete task.due; delete task.dueWeek; delete task.dueMonth; delete task.dueYear
    if(payload.scope === 'date') task.due = payload.due
    if(payload.scope === 'week') task.dueWeek = payload.due
    if(payload.scope === 'month') task.dueMonth = payload.due
    if(payload.scope === 'year') task.dueYear = payload.due
    save(db)
  } else {
    createTask(payload)
  }
  closeModal(); render()
}

// toggle controls when type changes: show year-color and the appropriate scope input
const typeEl = document.getElementById('type')
if(typeEl){
  typeEl.addEventListener('change', (e)=>{
  const wrap = document.getElementById('year-color-wrap')
  const val = e.target.value
  // show color selection for year and week
  if(val === 'year' || val === 'week') wrap.classList.remove('hidden')
  else wrap.classList.add('hidden')
  // default color for newly shown week selector
  if((val === 'week' || val === 'year') && document.getElementById('year-color')){
    const sel = document.getElementById('year-color')
    if(!sel.value || sel.value === '#fde68a') sel.value = (val === 'week' ? '#a78bfa' : '#fde68a')
  }
  // show scope input corresponding to type and manage required flag
  const allScopeEls = document.querySelectorAll('.scope-input')
  allScopeEls.forEach(el=> el.classList.add('hidden'))
  allScopeEls.forEach(el=>{ const inp = el.querySelector('input'); if(inp) inp.required = false })
    const dateEl = document.querySelector('.scope-input[data-scope="date"]')
    if(dateEl){ dateEl.classList.remove('hidden'); const inp = dateEl.querySelector('input'); if(inp) inp.required = true }
    // when switching types, default hidden scope values to current period if not already set
    const today = new Date().toISOString().slice(0,10)
    if(val === 'day'){
      const dd = document.getElementById('due-day')
      if(dd && !dd.value) dd.value = today
    } else if(val === 'week'){
      const wk = dateToWeekString(new Date())
      const el = document.getElementById('due-week'); if(el && !el.value) el.value = wk
    } else if(val === 'month'){
      const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const el = document.getElementById('due-month'); if(el && !el.value) el.value = ym
    } else if(val === 'year'){
      const el = document.getElementById('due-year'); if(el && !el.value) el.value = new Date().getFullYear()
    }
  })
}

// when the visible date input changes, derive and set hidden scope fields
const dueDayInput = document.getElementById('due-day')
if(dueDayInput){
  dueDayInput.addEventListener('change', (ev)=>{
    const val = ev.target.value
    if(!val) return
    const d = new Date(val + 'T00:00:00')
    // compute iso week string and month/year
    const wk = dateToWeekString(d)
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    const yy = d.getFullYear()
    const elW = document.getElementById('due-week')
    const elM = document.getElementById('due-month')
    const elY = document.getElementById('due-year')
    if(elW) elW.value = wk
    if(elM) elM.value = ym
    if(elY) elY.value = yy
  })
}

// To-Do form
const todoFormEl = document.getElementById('todo-form')
if(todoFormEl) todoFormEl.onsubmit = (e)=>{
  e.preventDefault();
  const titleEl = document.getElementById('todo-title')
  const linkEl = document.getElementById('todo-link')
  const title = titleEl ? titleEl.value.trim() : ''
  const link = linkEl ? linkEl.value || null : null
  if(!title) return
  createTodo(title, link)
  if(titleEl) titleEl.value = ''
}

// Export ICS (basic)
function toICSEvent(task){
  const uidStr = task.id + '@wochenplaner'
  const dtstamp = (new Date()).toISOString().replace(/[-:]/g,'').split('.')[0]+'Z'
  const dtstart = task.due ? task.due.replace(/-/g,'')+'T090000Z' : dtstamp
  const summary = escapeICSText(task.title)
  const description = escapeICSText(task.details || '')
  return `BEGIN:VEVENT\nUID:${uidStr}\nDTSTAMP:${dtstamp}\nDTSTART:${dtstart}\nSUMMARY:${summary}\nDESCRIPTION:${description}\nEND:VEVENT`
}

function exportAllAsICS(){
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wochenplaner//DE']
  for(const t of db.tasks){ lines.push(toICSEvent(t)) }
  lines.push('END:VCALENDAR')
  const blob = new Blob([lines.join('\n')], {type:'text/calendar'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'wochenplaner.ics'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

// Utilities
function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function escapeICSText(s){ return (s||'').replace(/\n/g,'\\n').replace(/,/g,'\\,') }

// initial sample data if empty
if(!db.tasks.length && !db.todos.length){
  const wk = dateToWeekString(new Date())
  const t1 = createTask({title:'Prepare homepage',type:'week',details:'Layout & content',scope:'week',due:wk})
  createTodo('Wireframe', t1.id)
  createTodo('Write copy', t1.id)
  createTask({title:'Define yearly plan',type:'year',details:'Goals for the year',scope:'year',due:new Date().getFullYear()})
}

render()
