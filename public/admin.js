const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => Array.from(document.querySelectorAll(selector))

const els = {
  app: $('#admin-app'),
  gate: $('#admin-gate'),
  gateMessage: $('#gate-message'),
  adminUser: $('#admin-user'),
  refreshAll: $('#refresh-all'),
  onlineWindow: $('#online-window'),
  metricGrid: $('#metric-grid'),
  tabs: $$('.tab'),
  panels: $$('.panel'),
  userFilter: $('#user-filter'),
  userQ: $('#user-q'),
  usersBody: $('#users-body'),
  usageFilter: $('#usage-filter'),
  usageFrom: $('#usage-from'),
  usageTo: $('#usage-to'),
  usageUserId: $('#usage-user-id'),
  usageEventType: $('#usage-event-type'),
  usageBody: $('#usage-body'),
  jobFilter: $('#job-filter'),
  jobQ: $('#job-q'),
  jobStatus: $('#job-status'),
  jobType: $('#job-type'),
  jobUserId: $('#job-user-id'),
  jobsBody: $('#jobs-body'),
  inspector: $('#job-inspector'),
  inspectorTitle: $('#inspector-title'),
  inspectorBody: $('#inspector-body'),
  closeInspector: $('#close-inspector'),
  toast: $('#toast'),
}

const state = {
  activeTab: 'users',
  users: [],
  jobs: [],
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoDate(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInt(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0))
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(4)}`
}

function formatDateTime(value) {
  if (!value) return '无记录'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function usageLabel(key) {
  return ({
    asset_upload: '素材上传',
    generate_direct_result: '画布生图',
    generate_result: 'AI 生图',
    translate_result: '翻译结果',
    outfit_result: '换装结果',
    auth_login: '登录',
    auth_register: '注册',
  })[key] || key || '未知'
}

function statusChip(status) {
  const failed = ['failed', 'partial_failed', 'cancelled'].includes(status)
  const running = ['queued', 'running'].includes(status)
  const cls = failed ? 'failed' : running ? 'running' : ''
  return `<span class="chip ${cls}">${escapeHtml(status || 'unknown')}</span>`
}

async function api(path) {
  const response = await fetch(path, { credentials: 'same-origin' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

function showToast(message) {
  els.toast.textContent = message
  els.toast.classList.remove('hidden')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 2600)
}

function showGate(error) {
  els.app.classList.add('hidden')
  els.gate.classList.remove('hidden')
  els.gateMessage.textContent = error?.status === 403
    ? '当前账号不在管理员白名单中。'
    : '请先使用管理员账号登录。'
}

function showApp() {
  els.gate.classList.add('hidden')
  els.app.classList.remove('hidden')
}

function setTab(tab) {
  state.activeTab = tab
  els.tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab))
  els.panels.forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tab}`))
}

async function boot() {
  els.usageFrom.value = daysAgoDate(30)
  els.usageTo.value = todayDate()
  bindEvents()
  try {
    const me = await api('/api/admin/me')
    els.adminUser.textContent = me.user ? `${me.user.name} · ${me.user.email}` : ''
    showApp()
    await refreshAll()
  } catch (error) {
    showGate(error)
  }
}

function bindEvents() {
  els.tabs.forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab))
  })
  els.refreshAll.addEventListener('click', () => refreshAll())
  els.onlineWindow.addEventListener('change', () => {
    void Promise.all([loadOverview(), loadUsers()])
  })
  els.userFilter.addEventListener('submit', (event) => {
    event.preventDefault()
    void loadUsers()
  })
  els.usageFilter.addEventListener('submit', (event) => {
    event.preventDefault()
    void loadUsage()
  })
  els.jobFilter.addEventListener('submit', (event) => {
    event.preventDefault()
    void loadJobs()
  })
  els.closeInspector.addEventListener('click', () => els.inspector.classList.remove('open'))
  els.usersBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-user-id]')
    if (!button) return
    const userId = button.dataset.userId
    els.usageUserId.value = userId
    els.jobUserId.value = userId
    setTab(button.dataset.target || 'usage')
    if (state.activeTab === 'usage') void loadUsage()
    if (state.activeTab === 'jobs') void loadJobs()
  })
  els.jobsBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-job-id]')
    if (!button) return
    void openJob(button.dataset.jobId)
  })
}

async function refreshAll() {
  try {
    await Promise.all([loadOverview(), loadUsers(), loadUsage(), loadJobs()])
    showToast('后台数据已刷新')
  } catch (error) {
    if (error.status === 401 || error.status === 403) showGate(error)
    else showToast(error.message || '刷新失败')
  }
}

async function loadOverview() {
  const params = new URLSearchParams({ onlineWindowMinutes: els.onlineWindow.value })
  const data = await api(`/api/admin/overview?${params}`)
  renderOverview(data)
}

function renderOverview(data) {
  const metrics = [
    {
      label: '用户总数',
      value: formatInt(data.users?.total),
      note: `在线 ${formatInt(data.users?.online)} · 24h 登录 ${formatInt(data.users?.loginUsers24h)}`,
    },
    {
      label: '活跃 Session',
      value: formatInt(data.users?.onlineSessions),
      note: `${data.onlineWindowMinutes || 5} 分钟内有请求视为在线`,
    },
    {
      label: '30 天用量',
      value: formatInt(data.usage?.last30DaysAmount),
      note: `Tokens ${formatInt((data.usage?.inputTokens || 0) + (data.usage?.outputTokens || 0))}`,
    },
    {
      label: '30 天 API 成本',
      value: formatMoney(data.usage?.apiCostUsd),
      note: '来自 usage_events.api_cost_usd',
    },
    {
      label: '任务总数',
      value: formatInt(data.jobs?.total),
      note: `24h 新增 ${formatInt(data.jobs?.last24h)}`,
    },
    {
      label: '画布项目',
      value: formatInt(data.projects?.total),
      note: 'owner 项目和历史项目合计',
    },
  ]
  els.metricGrid.innerHTML = metrics.map((metric) => `
    <article class="metric">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(metric.value)}</strong>
      <small>${escapeHtml(metric.note)}</small>
    </article>
  `).join('')
}

async function loadUsers() {
  const params = new URLSearchParams({
    q: els.userQ.value.trim(),
    limit: '100',
    onlineWindowMinutes: els.onlineWindow.value,
  })
  const data = await api(`/api/admin/users?${params}`)
  state.users = data.items || []
  renderUsers(state.users)
}

function renderUsers(users) {
  if (!users.length) {
    els.usersBody.innerHTML = '<tr><td colspan="10">没有匹配用户</td></tr>'
    return
  }
  els.usersBody.innerHTML = users.map((user) => `
    <tr>
      <td>${user.online ? '<span class="chip online">在线</span>' : '<span class="chip">离线</span>'}</td>
      <td class="main-cell">
        <strong>${escapeHtml(user.name || '未命名')}</strong>
        <span>${escapeHtml(user.email)}</span>
        <div class="subtle-id">${escapeHtml(user.id)}</div>
      </td>
      <td>${formatDateTime(user.lastLoginAt)}</td>
      <td>${formatDateTime(user.lastSeenAt)}</td>
      <td>${formatInt(user.onlineSessionCount)} / ${formatInt(user.activeSessionCount)}</td>
      <td>${formatInt(user.usageTotal)}</td>
      <td>${formatMoney(user.apiCostUsd)}</td>
      <td>${formatInt(user.jobCount)} <span class="subtle-id">失败 ${formatInt(user.failedJobCount)}</span></td>
      <td>${formatInt(user.projectCount)}</td>
      <td>
        <button class="row-action" type="button" data-user-id="${escapeHtml(user.id)}" data-target="usage">用量</button>
        <button class="row-action" type="button" data-user-id="${escapeHtml(user.id)}" data-target="jobs">任务</button>
      </td>
    </tr>
  `).join('')
}

async function loadUsage() {
  const params = new URLSearchParams({
    from: els.usageFrom.value,
    to: els.usageTo.value,
    userId: els.usageUserId.value.trim(),
    eventType: els.usageEventType.value,
    limit: '300',
  })
  const data = await api(`/api/admin/usage?${params}`)
  renderUsage(data.items || [])
}

function renderUsage(rows) {
  if (!rows.length) {
    els.usageBody.innerHTML = '<tr><td colspan="8">没有匹配用量</td></tr>'
    return
  }
  els.usageBody.innerHTML = rows.map((row) => {
    const identity = row.email
      ? `<strong>${escapeHtml(row.name || row.email)}</strong><span>${escapeHtml(row.email)}</span><div class="subtle-id">${escapeHtml(row.userId || '')}</div>`
      : `<strong>匿名会话</strong><div class="subtle-id">${escapeHtml(row.sessionId || '')}</div>`
    return `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td class="main-cell">${identity}</td>
        <td>${escapeHtml(usageLabel(row.eventType))}<div class="subtle-id">${escapeHtml(row.eventType)}</div></td>
        <td>${escapeHtml(row.modelId || '无')}<div class="subtle-id">${escapeHtml(row.provider || '')}</div></td>
        <td>${formatInt(row.amount)} <span class="subtle-id">事件 ${formatInt(row.eventCount)}</span></td>
        <td>${formatInt((row.inputTokens || 0) + (row.outputTokens || 0))}</td>
        <td>${formatMoney(row.apiCostUsd)}</td>
        <td>${formatDateTime(row.lastAt)}</td>
      </tr>
    `
  }).join('')
}

async function loadJobs() {
  const params = new URLSearchParams({
    q: els.jobQ.value.trim(),
    status: els.jobStatus.value,
    type: els.jobType.value,
    userId: els.jobUserId.value.trim(),
    limit: '100',
  })
  const data = await api(`/api/admin/jobs?${params}`)
  state.jobs = data.items || []
  renderJobs(state.jobs)
}

function renderJobs(jobs) {
  if (!jobs.length) {
    els.jobsBody.innerHTML = '<tr><td colspan="8">没有匹配任务</td></tr>'
    return
  }
  els.jobsBody.innerHTML = jobs.map((job) => {
    const progress = `${formatInt(job.progressDone)} / ${formatInt(job.progressTotal)}`
    const user = job.user
      ? `<strong>${escapeHtml(job.user.name || job.user.email)}</strong><span>${escapeHtml(job.user.email)}</span><div class="subtle-id">${escapeHtml(job.user.id)}</div>`
      : '<strong>匿名</strong>'
    return `
      <tr>
        <td>${formatDateTime(job.updatedAt)}</td>
        <td class="main-cell">
          <strong>${escapeHtml(job.type)}</strong>
          <div class="subtle-id">${escapeHtml(job.id)}</div>
        </td>
        <td class="main-cell">${user}</td>
        <td>${statusChip(job.status)}</td>
        <td>${progress}<div class="subtle-id">失败 ${formatInt(job.progressFailed)} · items ${formatInt(job.itemCount)}</div></td>
        <td>${formatInt(job.usageAmount)}</td>
        <td>${formatMoney(job.apiCostUsd)}</td>
        <td><button class="row-action" type="button" data-job-id="${escapeHtml(job.id)}">明细</button></td>
      </tr>
    `
  }).join('')
}

async function openJob(jobId) {
  try {
    const data = await api(`/api/admin/jobs/${encodeURIComponent(jobId)}/items`)
    els.inspectorTitle.textContent = jobId
    els.inspectorBody.innerHTML = renderJobInspector(data.job, data.items || [])
    els.inspector.classList.add('open')
  } catch (error) {
    showToast(error.message || '任务明细加载失败')
  }
}

function renderJobInspector(job, items) {
  const jobJson = escapeHtml(JSON.stringify({
    type: job.type,
    status: job.status,
    sessionId: job.sessionId,
    userId: job.userId,
    progressTotal: job.progressTotal,
    progressDone: job.progressDone,
    progressFailed: job.progressFailed,
    configJson: job.configJson,
    summaryJson: job.summaryJson,
  }, null, 2))
  const blocks = items.map((item) => `
    <article class="item-block">
      <h3>${escapeHtml(item.itemType)} · ${statusChip(item.status)}</h3>
      <div class="subtle-id">${escapeHtml(item.id)}</div>
      <pre>${escapeHtml(JSON.stringify({
        attempts: item.attemptCount,
        startedAt: item.startedAt,
        finishedAt: item.finishedAt,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        inputJson: item.inputJson,
        outputJson: item.outputJson,
      }, null, 2))}</pre>
    </article>
  `).join('')
  return `
    <article class="item-block">
      <h3>任务配置</h3>
      <pre>${jobJson}</pre>
    </article>
    ${blocks || '<p>没有任务项</p>'}
  `
}

void boot()
