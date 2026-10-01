/* =============================================
   MZANTSI VIBES — tasks-script.js
   Fetches TASKS.md, parses tasks, renders
   with live filtering by status/difficulty/type
   ============================================= */

const TASKS_URL = 'https://raw.githubusercontent.com/realtimshady16/mzantsi-vibes/main/TASKS.md';

const STATUS_MAP = {
  '🔴 needs doing': 'needs-doing',
  '🟡 in progress': 'in-progress',
  '🟢 done':        'done',
};

const STATUS_LABEL = {
  'needs-doing': { dot: 'dot-todo',  label: 'Needs doing' },
  'in-progress': { dot: 'dot-doing', label: 'In progress' },
  'done':        { dot: 'dot-done',  label: 'Done' },
};

const TYPE_CLASS = {
  'content':     'chip-content',
  'translation': 'chip-translation',
  'code':        'chip-code',
  'design':      'chip-design',
};

/* Active filter state */
const activeFilters = { status: 'all', difficulty: 'all', type: 'all' };

/* All parsed tasks */
let allTasks = [];

/* ---- PARSER ---- */

function parseTasks(markdown) {
  const lines = markdown.split('\n');
  const tasks = [];
  let currentStatus = null;
  let currentTask = null;

  const pushTask = () => {
    if (currentTask && currentTask.number && currentTask.title) {
      tasks.push(currentTask);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    /* Status group heading (## 🔴 Needs doing) */
    if (/^##\s/.test(trimmed)) {
      const headingText = trimmed.replace(/^##\s*/, '').toLowerCase();
      const matchedStatus = Object.keys(STATUS_MAP).find(k => headingText.includes(k));
      if (matchedStatus) {
        pushTask();
        currentTask = null;
        currentStatus = STATUS_MAP[matchedStatus];
      }
      continue;
    }

    /* Task heading (### #001 Title) */
    if (/^###\s+#\d+/.test(trimmed) && currentStatus) {
      pushTask();
      const match = trimmed.match(/^###\s+(#\d+)\s+(.+)$/);
      if (match) {
        currentTask = {
          number:     match[1],
          title:      match[2].trim(),
          status:     currentStatus,
          section:    '',
          difficulty: '',
          type:       [],
          description:'',
          goodFor:    '',
          assignedTo: '',
        };
      }
      continue;
    }

    if (!currentTask) continue;

    /* Field lines */
    if (/^\*\*Section:\*\*/.test(trimmed)) {
      currentTask.section = trimmed.replace(/^\*\*Section:\*\*\s*/, '').trim();
    } else if (/^\*\*Difficulty:\*\*/.test(trimmed)) {
      currentTask.difficulty = trimmed.replace(/^\*\*Difficulty:\*\*\s*/, '').trim().toLowerCase();
    } else if (/^\*\*Type:\*\*/.test(trimmed)) {
      const typeRaw = trimmed.replace(/^\*\*Type:\*\*\s*/, '').trim();
      currentTask.type = typeRaw.split(/[·,\/]/).map(t => t.trim().toLowerCase()).filter(Boolean);
    } else if (/^\*\*Description:\*\*/.test(trimmed)) {
      currentTask.description = trimmed.replace(/^\*\*Description:\*\*\s*/, '').trim();
      /* Description may continue on following lines until next field or blank */
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next || /^\*\*/.test(next) || /^---/.test(next) || /^#{2,3}/.test(next)) break;
        currentTask.description += ' ' + next;
        i = j;
      }
    } else if (/^\*\*Good for:\*\*/.test(trimmed)) {
      currentTask.goodFor = trimmed.replace(/^\*\*Good for:\*\*\s*/, '').trim();
    } else if (/^\*\*Assigned to:\*\*/.test(trimmed)) {
      currentTask.assignedTo = trimmed.replace(/^\*\*Assigned to:\*\*\s*/, '').trim();
    }
  }

  pushTask();
  return tasks;
}

/* ---- RENDERER ---- */

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTask(task) {
  const statusInfo = STATUS_LABEL[task.status] || { dot: 'dot-todo', label: task.status };

  const typeChips = task.type.map(t =>
    `<span class="chip ${TYPE_CLASS[t] || 'chip-other'}">${escHtml(t)}</span>`
  ).join('');

  const diffChip = task.difficulty
    ? `<span class="chip chip-diff">${escHtml(task.difficulty)}</span>`
    : '';

  const meta = [];
  if (task.section)    meta.push(`<span><b>Section</b> ${escHtml(task.section)}</span>`);
  if (task.goodFor)    meta.push(`<span><b>Good for</b> ${escHtml(task.goodFor)}</span>`);
  if (task.assignedTo) meta.push(`<span><b>In progress</b> ${escHtml(task.assignedTo)}</span>`);

  return `
    <article class="task-card${task.status === 'done' ? ' task-done' : ''}"
         data-status="${escHtml(task.status)}"
         data-difficulty="${escHtml(task.difficulty)}"
         data-type="${escHtml(task.type.join(' '))}">
      <div class="task-main">
        <div class="task-status">
          <span class="dot ${statusInfo.dot}" aria-hidden="true"></span>${escHtml(statusInfo.label)}${task.number ? `<span class="task-number">${escHtml(task.number)}</span>` : ''}
        </div>
        <h3 class="task-title">${escHtml(task.title)}</h3>
        ${task.description ? `<p class="task-description">${escHtml(task.description)}</p>` : ''}
        ${meta.length ? `<p class="task-meta">${meta.join('')}</p>` : ''}
      </div>
      <div class="task-chips">${diffChip}${typeChips}</div>
    </article>`;
}

function renderAll() {
  const container = document.getElementById('tasks-container');
  const countEl = document.getElementById('task-count');
  if (!container) return;

  const filtered = allTasks.filter(task => {
    const statusMatch = activeFilters.status === 'all' || task.status === activeFilters.status;
    const diffMatch   = activeFilters.difficulty === 'all' || task.difficulty === activeFilters.difficulty;
    const typeMatch   = activeFilters.type === 'all' || task.type.includes(activeFilters.type);
    return statusMatch && diffMatch && typeMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-state">No tasks match those filters. <button type="button" class="link-btn" onclick="resetFilters()">Clear filters</button></p>`;
    if (countEl) countEl.textContent = '';
    return;
  }

  /* One flat list, open work first. Each card carries its own status. */
  const order = { 'needs-doing': 0, 'in-progress': 1, 'done': 2 };
  const sorted = filtered
    .map((task, i) => ({ task, i }))
    .sort((a, b) => (order[a.task.status] ?? 3) - (order[b.task.status] ?? 3) || a.i - b.i)
    .map(x => x.task);

  container.innerHTML = sorted.map(renderTask).join('');

  const open = allTasks.filter(t => t.status === 'needs-doing').length;
  if (countEl) {
    countEl.textContent = filtered.length === allTasks.length
      ? `${open} open task${open !== 1 ? 's' : ''} · ${allTasks.length} total`
      : `Showing ${filtered.length} of ${allTasks.length} tasks`;
  }
}

/* ---- FILTERS ---- */

function applyFilter(btn) {
  const filterType = btn.dataset.filter;
  const value = btn.dataset.value;

  /* Update active state on pills within same group */
  btn.closest('.filter-pills').querySelectorAll('.filter-pill').forEach(p => {
    p.classList.remove('active');
    p.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');

  activeFilters[filterType] = value;
  renderAll();
}

function resetFilters() {
  Object.keys(activeFilters).forEach(k => activeFilters[k] = 'all');
  document.querySelectorAll('.filter-pill').forEach(p => {
    const on = p.dataset.value === 'all';
    p.classList.toggle('active', on);
    p.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderAll();
}

/* ---- INIT ---- */

async function init() {
  const loadingEl = document.getElementById('loading-state');
  const errorEl   = document.getElementById('error-state');

  try {
    const res = await fetch(TASKS_URL);
    if (!res.ok) throw new Error('Failed to fetch TASKS.md');
    const markdown = await res.text();
    allTasks = parseTasks(markdown);

    loadingEl.classList.add('hidden');
    renderAll();
  } catch (err) {
    console.error('Could not load TASKS.md:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
