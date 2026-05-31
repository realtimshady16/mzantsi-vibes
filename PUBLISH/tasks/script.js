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
  'needs-doing': { emoji: '🔴', label: 'Needs doing' },
  'in-progress': { emoji: '🟡', label: 'In progress' },
  'done':        { emoji: '🟢', label: 'Done' },
};

const DIFFICULTY_CLASS = {
  'easy':   'badge-easy',
  'medium': 'badge-medium',
  'hard':   'badge-hard',
};

const TYPE_CLASS = {
  'content':     'badge-content',
  'translation': 'badge-translation',
  'code':        'badge-code',
  'design':      'badge-design',
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
  const statusInfo = STATUS_LABEL[task.status] || { emoji: '', label: task.status };
  const diffClass = DIFFICULTY_CLASS[task.difficulty] || 'badge-default';

  const typeBadges = task.type.map(t => {
    const cls = TYPE_CLASS[t] || 'badge-default';
    return `<span class="badge ${cls}">${escHtml(t)}</span>`;
  }).join('');

  const goodForHtml = task.goodFor
    ? `<div class="task-good-for">✅ <span>${escHtml(task.goodFor)}</span></div>`
    : '';

  const assignedHtml = task.assignedTo
    ? `<div class="task-assigned">👤 In progress: <strong>${escHtml(task.assignedTo)}</strong></div>`
    : '';

  const sectionHtml = task.section
    ? `<div class="task-section">📂 ${escHtml(task.section)}</div>`
    : '';

  const isDone = task.status === 'done';

  return `
    <div class="task-card ${isDone ? 'task-done' : ''}"
         data-status="${escHtml(task.status)}"
         data-difficulty="${escHtml(task.difficulty)}"
         data-type="${escHtml(task.type.join(' '))}">
      <div class="task-header">
        <div class="task-meta-top">
          <span class="task-number">${escHtml(task.number)}</span>
          ${task.difficulty ? `<span class="badge ${diffClass}">${escHtml(task.difficulty)}</span>` : ''}
          ${typeBadges}
        </div>
        <span class="task-status-dot">${statusInfo.emoji}</span>
      </div>
      <h3 class="task-title">${escHtml(task.title)}</h3>
      ${sectionHtml}
      ${task.description ? `<p class="task-description">${escHtml(task.description)}</p>` : ''}
      ${goodForHtml}
      ${assignedHtml}
    </div>`;
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
    container.innerHTML = `<p class="empty-state">No tasks match those filters. <button class="link-btn" onclick="resetFilters()">Clear filters</button></p>`;
    if (countEl) countEl.textContent = '';
    return;
  }

  /* Group by status */
  const groups = {};
  filtered.forEach(task => {
    if (!groups[task.status]) groups[task.status] = [];
    groups[task.status].push(task);
  });

  const statusOrder = ['needs-doing', 'in-progress', 'done'];
  let html = '';

  statusOrder.forEach(status => {
    if (!groups[status] || groups[status].length === 0) return;
    const info = STATUS_LABEL[status];
    html += `<div class="status-group">
      <h2 class="status-heading">${info.emoji} ${escHtml(info.label)} <span class="status-count">${groups[status].length}</span></h2>
      <div class="task-grid">
        ${groups[status].map(renderTask).join('')}
      </div>
    </div>`;
  });

  container.innerHTML = html;

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
  btn.closest('.filter-pills').querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');

  activeFilters[filterType] = value;
  renderAll();
}

function resetFilters() {
  Object.keys(activeFilters).forEach(k => activeFilters[k] = 'all');
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.value === 'all');
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
