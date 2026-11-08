(() => {
  const root = document.documentElement;
  let theme = 'system';
  try { theme = localStorage.getItem('sample-theme') || 'system'; } catch {}
  const themeButton = document.querySelector('[data-theme-toggle]');
  function applyTheme() {
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const label = themeButton?.querySelector('[data-theme-label]');
    if (label) label.textContent = theme[0].toUpperCase() + theme.slice(1);
    themeButton?.setAttribute('aria-label', `Color theme: ${theme}. Change theme`);
  }
  applyTheme();
  themeButton?.addEventListener('click', () => {
    theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    try { localStorage.setItem('sample-theme', theme); } catch {}
    applyTheme();
  });
  function localTimes(scope = document) {
    scope.querySelectorAll('[data-local-time]').forEach(el => {
      const date = new Date(el.getAttribute('datetime'));
      const compact = el.hasAttribute('data-compact');
      el.textContent = new Intl.DateTimeFormat(undefined, compact
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' }).format(date);
    });
  }
  localTimes();
  const announcement = document.createElement('span');
  announcement.className = 'sr-only';
  announcement.setAttribute('role', 'status');
  document.body.append(announcement);
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      if (button.dataset.copied) return;
      await navigator.clipboard.writeText(button.dataset.copy);
      const original = button.innerHTML, label = button.getAttribute('aria-label');
      button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      announcement.textContent = 'Copied to clipboard.';
      button.setAttribute('aria-label', 'Copied to clipboard');
      button.dataset.copied = 'true';
      setTimeout(() => { delete button.dataset.copied; button.innerHTML = original; button.setAttribute('aria-label', label); }, 1800);
    } catch { announcement.textContent = 'Copy unavailable. Select and copy the text directly.'; }
  });
  document.querySelectorAll('.approval-review').forEach(details => details.addEventListener('toggle', () => {
    if (details.open) details.querySelector('.confirmation')?.scrollIntoView({
      block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
  }));
  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', () => {
    // Preserve the submitter's name/value in the native POST.
    form.setAttribute('aria-busy', 'true');
    setTimeout(() => form.querySelectorAll('button').forEach(button => { button.disabled = true; }), 0);
  }));
  const queue = document.querySelector('[data-live-queue]');
  if (!queue) return;
  let filter = 'all', revision = queue.dataset.revision, polling = false, stopped = false, pending = false;
  function filterRows() {
    queue.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
    let visible = 0;
    const rows = queue.querySelectorAll('[data-request-status]');
    rows.forEach(row => {
      const state = row.dataset.requestStatus;
      row.hidden = filter === 'HELD' ? state !== 'HELD' : filter === 'closed' ? !['POSTED','DENIED','EXPIRED','TELLER_DENIED','UPSTREAM_REJECTED'].includes(state) : false;
      if (!row.hidden) visible++;
    });
    queue.querySelector('.filter-empty').hidden = !rows.length || visible > 0;
  }
  queue.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (button) { filter = button.dataset.filter; filterRows(); }
  });
  const status = text => { const el = queue.querySelector('[data-sync-status]'); if (el) el.textContent = text; };
  async function poll() {
    if (polling || stopped || document.hidden) return;
    polling = true;
    try {
      const response = await fetch('/queue/snapshot', { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (response.status === 401) { stopped = true; status('Session ended · reconnect'); announcement.textContent = 'Your sample session ended. Start a new session from your client.'; return; }
      if (!response.ok) throw new Error('Unavailable');
      const next = await response.json();
      if (next.revision !== revision) {
        if (queue.contains(document.activeElement)) {
          pending = true;
          status('New activity · waiting for focus to move');
          return;
        }
        queue.innerHTML = next.html;
        revision = next.revision;
        localTimes(queue); filterRows();
        announcement.textContent = 'Transfer queue updated.';
      }
      pending = false;
      status('Up to date · checks every 15s');
    } catch { status('Updates paused · retrying'); }
    finally { polling = false; }
  }
  queue.addEventListener('focusout', () => queueMicrotask(() => {
    if (pending && !queue.contains(document.activeElement)) poll();
  }));
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
