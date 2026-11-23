// Tauri: each #[tauri::command] fn is an endpoint `INVOKE /<name>` in its Rust file, and the frontend's
// invoke('<name>') calls are linked to it. A repo can hold several Tauri apps with commands of the same name,
// so a call goes to the command in its own app (the folder holding src-tauri/) when there is one there.
// ponytail: literal command names only; invoke(variable) and renamed commands aren't followed.

const COMMAND = /#\[tauri::command(?:\([^)\]]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/g;
// not obj.invoke(...): SignalR, Supabase and others have methods by that name
const INVOKE = /(?<![\w.$])invoke\s*(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\s*\(\s*['"`]([\w-]+)['"`]/g;
const JS = new Set(['typescript', 'javascript', 'vue', 'svelte', 'astro']);
const lineAt = (src, i) => src.slice(0, i).split('\n').length;
/** The Tauri app a path belongs to: the folder holding its src-tauri/, or null. */
const appOf = (p) => { const m = /^(.*?)src-tauri\//.exec(p); return m ? m[1] : null; };

/**
 * Adds Tauri command endpoints to `routes` and returns the frontend -> command links.
 * @param files scan files ({ path, lang, tooLarge })
 * @param routes the scan's routes, added to
 * @param read (path) => file text, '' when it can't be read
 * @returns { http: [{ from, to, method, path, call, line, routeLine }], commands }
 */
export function tauriLinks(files, routes, read) {
  const byName = new Map(); // command name -> [route]
  for (const f of files) {
    if (f.lang !== 'rust' || f.tooLarge) continue;
    const src = read(f.path);
    if (!src.includes('tauri::command')) continue;
    for (const m of src.matchAll(COMMAND)) {
      const r = { file: f.path, method: 'INVOKE', path: '/' + m[1], line: lineAt(src, m.index), handler: m[1], framework: 'tauri' };
      routes.push(r);
      if (!byName.has(m[1])) byName.set(m[1], []);
      byName.get(m[1]).push(r);
    }
  }
  if (!byName.size) return { http: [], commands: 0 };
  const apps = [...new Set([...byName.values()].flat().map((r) => appOf(r.file)))].filter((a) => a != null).sort((a, b) => b.length - a.length);
  const http = [];
  for (const f of files) {
    if (!JS.has(f.lang) || f.tooLarge) continue;
    const src = read(f.path);
    if (!src.includes('invoke')) continue;
    const app = apps.find((a) => f.path.startsWith(a));
    for (const m of src.matchAll(INVOKE)) {
      const all = byName.get(m[1]);
      if (!all) continue;
      const own = all.filter((r) => app != null && appOf(r.file) === app);
      for (const r of own.length ? own : all) http.push({ from: f.path, to: r.file, method: 'INVOKE', path: r.path, call: r.path, line: lineAt(src, m.index), routeLine: r.line });
    }
  }
  return { http, commands: [...byName.values()].flat().length };
}
