#!/usr/bin/env node
// Jira tasks for the map: issue keys (ABC-123) in recent commit messages and branch names, each with the files
// those commits touched, plus any issues a JQL query names. Details come from Jira Server/Data Center and go to
// floorplan/jira.json, which build.mjs puts on the map. The token is read from the environment and never written.
//
// usage: JIRA_URL=https://jira.example.com JIRA_TOKEN=<personal access token> \
//        node jira.mjs [root] [--days 90] [--jql "assignee = currentUser() AND resolution = Unresolved"]
import fs from 'node:fs';
import path from 'node:path';
import { git, parseArgs, mapDir, readJsonFile } from './lib/common.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args._[0] || '.');
const dir = mapDir(root);
const days = Number(args.days) || 90;
const base = (process.env.JIRA_URL || '').replace(/\/+$/, '');
const token = process.env.JIRA_TOKEN || '';
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
if (!/^https?:\/\//.test(base) || !token) fail('Set JIRA_URL (https://jira.example.com) and JIRA_TOKEN (a Jira personal access token).');

let scan;
try { scan = readJsonFile(path.join(dir, '.cache', 'scan.json')); } catch { fail('No floorplan/.cache/scan.json. Run scan.mjs first.'); }

// ---------- keys from git: commit subjects and the branches pointing at them ----------
const KEY = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const files = new Map(); // key -> Set(path from root)
const add = (key, p) => { if (!files.has(key)) files.set(key, new Set()); if (p) files.get(key).add(p); };
for (const repo of scan.repos || []) {
  const cwd = path.join(root, repo.path || '.');
  const prefix = repo.path && repo.path !== '.' ? repo.path + '/' : '';
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '';
  for (const k of branch.match(KEY) || []) add(k);
  const log = git(cwd, ['log', `--since=${days}.days`, '--name-only', '--format=%x00%s%x1f%D']) || '';
  for (const entry of log.split('\0').slice(1)) {
    const [head, ...paths] = entry.split('\n');
    const keys = [...new Set(head.match(KEY) || [])];
    for (const k of keys) { add(k); for (const p of paths) if (p.trim()) add(k, prefix + p.trim()); }
  }
}

// ---------- Jira ----------
const FIELDS = 'summary,status,assignee,issuetype,priority,updated';
const get = async (url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) fail(`Jira refused the token (${res.status}). Check JIRA_TOKEN and that it can read these projects.`);
  return res.ok ? res.json() : null;
};
const shape = (i) => ({
  key: i.key,
  summary: i.fields?.summary || '',
  status: i.fields?.status?.name || '',
  // new / indeterminate / done: lets the map color open, in-progress and finished work
  cat: i.fields?.status?.statusCategory?.key || '',
  type: i.fields?.issuetype?.name || '',
  priority: i.fields?.priority?.name || '',
  assignee: i.fields?.assignee?.displayName || '',
  updated: i.fields?.updated || '',
  url: `${base}/browse/${i.key}`,
});
const issues = new Map();
if (args.jql) {
  const r = await get(`${base}/rest/api/2/search?maxResults=200&fields=${FIELDS}&jql=${encodeURIComponent(args.jql)}`);
  if (!r) fail('Jira rejected the JQL query.');
  for (const i of r.issues || []) issues.set(i.key, shape(i));
}
// one request per key: a search with `key in (...)` fails whole when any key (a false match like UTF-8) doesn't exist
const pending = [...files.keys()].filter((k) => !issues.has(k));
let notFound = 0;
for (let i = 0; i < pending.length; i += 8) {
  await Promise.all(pending.slice(i, i + 8).map(async (k) => {
    const r = await get(`${base}/rest/api/2/issue/${encodeURIComponent(k)}?fields=${FIELDS}`);
    if (r) issues.set(r.key, shape(r)); else notFound++;
  }));
}

const out = {
  updatedAt: new Date().toISOString(),
  base,
  issues: [...issues.values()].map((i) => ({ ...i, files: [...(files.get(i.key) || [])].sort() })).sort((a, b) => (b.updated || '').localeCompare(a.updated || '')),
};
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'jira.json'), JSON.stringify(out, null, 2) + '\n');
const linked = out.issues.filter((i) => i.files.length).length;
console.log(`✓ wrote ${path.relative(process.cwd(), path.join(dir, 'jira.json'))}: ${out.issues.length} issue(s), ${linked} linked to code from the last ${days} days of commits${notFound ? `, ${notFound} key-like name(s) Jira doesn't know skipped` : ''}. Run build.mjs to put them on the map.`);
