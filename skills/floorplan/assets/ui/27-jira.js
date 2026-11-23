// Jira: issues from floorplan/jira.json (graph.jira), each tied to the cards its commits touched. Adds a header
// button that lists them, a board per issue, and on a selected card the issues that touched it or anything inside.
(() => {
  const SC = window.Floorplan;
  const J = SC && SC.graph.jira;
  if (!J || !J.issues || !J.issues.length) return;
  const { h, hk } = SC;
  const issues = J.issues.map((i) => ({ ...i, ids: (i.ids || []).filter((id) => SC.exists(id)) }));

  SC.icons.jira = '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z"/><path d="M13 16.5h7M16.5 13v7"/>';
  const style = document.createElement('style');
  style.textContent = `
    #btn-jira svg.i { color: var(--k-rpc); }
    #btn-jira .badge { background: var(--k-rpc); color: var(--on-recent-text); }
    .jr { padding: 10px 12px; border-radius: 14px; background: var(--well); margin-bottom: 6px; }
    .jr-h { display: flex; gap: 8px; align-items: center; font-size: 12px; }
    .jr-k { font-weight: 600; color: var(--text); text-decoration: none; }
    .jr-k:hover { text-decoration: underline; }
    .jr-st { border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--text-3) 15%, transparent); color: var(--text-2); }
    .jr-st.indeterminate { background: color-mix(in srgb, var(--k-rpc) 18%, transparent); color: var(--k-rpc); }
    .jr-st.done { background: color-mix(in srgb, var(--recent) 16%, transparent); color: var(--recent); }
    .jr-s { margin-top: 5px; font-size: 13px; line-height: 1.45; color: var(--text); }
    .jr-m { margin-top: 4px; font-size: 11.5px; color: var(--text-3); }
    .jr .btn { margin-top: 8px; height: 28px; padding: 0 10px; font-size: 12px; gap: 6px; }
  `;
  document.head.appendChild(style);

  const row = (i) => `<div class="jr"><div class="jr-h">${i.url ? `<a class="jr-k" href="${h(i.url)}" data-jira-url="${h(i.url)}">${h(i.key)}</a>` : `<span class="jr-k">${h(i.key)}</span>`}<span class="jr-st ${h(i.cat)}">${h(i.status || '?')}</span></div>
    <div class="jr-s">${h(i.summary)}</div>
    <div class="jr-m">${[i.type, i.assignee || 'Unassigned', i.updated ? i.updated.slice(0, 10) : ''].filter(Boolean).map(h).join(' · ')}</div>
    ${i.ids.length ? `<button class="btn soft" data-jira="${h(i.key)}">${SC.iconI('jira')}Show ${SC.plural(i.ids.length, 'card')}</button>` : ''}</div>`;
  const bind = (el) => {
    el.querySelectorAll('[data-jira]').forEach((x) => x.addEventListener('click', () => show(x.dataset.jira)));
    // the viewer's opener: falls back to showing the address when the page can't open windows
    el.querySelectorAll('[data-jira-url]').forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); SC.openWindow(x.dataset.jiraUrl); }));
  };
  const list = () => `<div class="sec"><h3>Jira <span class="c">${issues.length}</span></h3><div style="margin-top:10px">${issues.map(row).join('')}</div></div>`;

  function show(key) {
    const i = issues.find((x) => x.key === key);
    if (!i) return;
    SC.showBoard({ kind: 'Jira', icon: 'jira', title: `${i.key} · ${i.summary}`, question: `${i.status}${i.assignee ? ` · ${i.assignee}` : ''}`, items: i.ids.map((id) => ({ id, note: i.key })) });
  }

  const btn = SC.addHeaderButton({ id: 'btn-jira', label: 'Jira', icon: 'jira', title: 'Jira issues and the code they touched', onClick: () => SC.showPanel(list(), bind) });
  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = String(issues.filter((i) => i.cat !== 'done').length || issues.length);
  btn.appendChild(b);

  SC.addPanelSection('overview', () => ({
    top: true,
    html: list(),
    bind,
  }));

  // a card: the issues that touched it; a part: the issues that touched anything inside it
  SC.addPanelSection('item', (id) => {
    const key = id.startsWith('m:') ? 'f:' + id.slice(2) : id;
    const mine = issues.filter((i) => i.ids.some((x) => x === key || SC.chain(x).includes(key)));
    if (!mine.length) return '';
    return { html: `<div class="sec"><h3>Jira <span class="c">${mine.length}</span></h3>${mine.map(row).join('')}</div>`, bind };
  });

  window.FloorplanJira = { show, issues };
})();
