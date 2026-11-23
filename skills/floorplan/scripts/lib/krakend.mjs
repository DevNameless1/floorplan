// KrakenD API gateway: krakend.json lists the gateway's public endpoints and, for each, the backends it forwards
// to. Each endpoint is a route answered by krakend.json, and each backend is a call from it, so the existing
// matcher links frontend -> gateway -> backend. A gRPC backend's url_pattern is already its wire address
// (/pkg.Service/Method), which lib/grpc.mjs gives the Go method that implements it.

const GRPC_PATH = /^\/[\w.]+\.\w+\/\w+$/;

/** { routes, calls } for one krakend.json; empty when it isn't one (no endpoints array). */
export function extractKrakend(src) {
  let cfg;
  try { cfg = JSON.parse(src); } catch { return { routes: [], calls: [] }; }
  const routes = [], calls = [];
  const lineOf = (needle, from = 0) => {
    const i = src.indexOf(needle, from);
    return i < 0 ? { line: 0, i: from } : { line: src.slice(0, i).split('\n').length, i };
  };
  let cursor = 0;
  for (const e of Array.isArray(cfg?.endpoints) ? cfg.endpoints : []) {
    if (typeof e?.endpoint !== 'string') continue;
    const method = (e.method || 'GET').toUpperCase();
    // endpoints appear in file order, so search on from the last one: the same path can be listed per method
    const at = lineOf(JSON.stringify(e.endpoint), cursor);
    cursor = at.i + 1;
    routes.push({ method, path: e.endpoint, var: null, line: at.line, framework: 'krakend' });
    for (const b of Array.isArray(e.backend) ? e.backend : []) {
      if (typeof b?.url_pattern !== 'string') continue;
      const grpc = GRPC_PATH.test(b.url_pattern) || Object.keys(b.extra_config || {}).some((k) => k.includes('grpc'));
      calls.push({ path: b.url_pattern, method: grpc ? 'POST' : (b.method || method).toUpperCase(), line: lineOf(JSON.stringify(b.url_pattern), at.i).line });
    }
  }
  return { routes, calls };
}

const STR = `'(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*"`;
const unquote = (s) => s.slice(1, -1);
// a field name, bare or quoted: endpoint: / 'endpoint': / "endpoint":
const key = (name) => `(?:\\b${name}|'${name}'|"${name}")\\s*:\\s*`;
const ARG = `(?:${STR}|[\\w.]+)`;

/** The text of a brace-balanced block starting at src[open] === '{'. */
function block(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/**
 * KrakenD flexible config written in Jsonnet (krakend.json then generated and often gitignored). Not a Jsonnet
 * evaluator: local helpers called with string literals are inlined, 'a' + 'b' is joined, and then each
 * `endpoint: '...'` object gives a route and its `url_pattern: '...'` backends give calls.
 * ponytail: helpers fed computed arguments or imported from other files are missed; run real jsonnet if that matters.
 */
export function extractKrakendJsonnet(src) {
  if (src.length > 1_000_000) return { routes: [], calls: [] };
  let code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"])\/\/[^\n]*/g, '$1').replace(/^\s*#[^\n]*/gm, '');
  if (!new RegExp(key('endpoint')).test(code)) return { routes: [], calls: [] };
  const helpers = new Map();
  for (const m of code.matchAll(/\blocal\s+(\w+)\s*\(([^)]*)\)\s*=\s*\{/g)) {
    helpers.set(m[1], { params: m[2].split(',').map((p) => p.trim().split('=')[0].trim()).filter((p) => /^\w+$/.test(p)), body: block(code, m.index + m[0].length - 1) });
  }
  // inline helpers called with literals only; a few rounds reach helpers used inside helpers
  for (let round = 0; round < 3 && helpers.size; round++) {
    const before = code;
    code = code.replace(new RegExp(`(?<!local\\s+)\\b(${[...helpers.keys()].join('|')})\\s*\\(\\s*((?:${ARG}(?:\\s*,\\s*${ARG})*)?)\\s*,?\\s*\\)`, 'g'), (whole, name, argText) => {
      const h = helpers.get(name);
      const args = [...argText.matchAll(new RegExp(ARG, 'g'))].map((a) => a[0]);
      // a parameter as a value (`url_pattern: rpc`, `'/x/' + rpc`), not as a key (`endpoint: endpoint`)
      return h.params.reduce((body, p, i) => (args[i] === undefined ? body : body.replace(new RegExp(`(?<![\\w.'"])${p}\\b(?!\\s*:)`, 'g'), args[i])), h.body);
    });
    if (code === before) break;
  }
  code = code.replace(new RegExp(`(${STR})\\s*\\+\\s*(${STR})`, 'g'), (m, a, b) => `'${unquote(a)}${unquote(b)}'`);

  const routes = [], calls = [];
  const eps = [...code.matchAll(new RegExp(`${key('endpoint')}(${STR})`, 'g'))];
  let cursor = 0;
  eps.forEach((m, k) => {
    const seg = code.slice(m.index, eps[k + 1]?.index ?? code.length);
    const p = unquote(m[1]);
    const method = (new RegExp(`${key('method')}(${STR})`).exec(seg)?.[1].slice(1, -1) || 'GET').toUpperCase();
    // where the original text spells it out: as the endpoint field, else as a helper's first argument
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${key('endpoint')}['"]${esc}['"]|\\(\\s*['"]${esc}['"]`, 'g');
    re.lastIndex = cursor;
    const hit = re.exec(src);
    const at = hit ? { line: src.slice(0, hit.index).split('\n').length, i: hit.index } : { line: 0, i: cursor };
    cursor = at.i + 1;
    routes.push({ method, path: p, var: null, line: at.line, framework: 'krakend' });
    for (const b of seg.matchAll(new RegExp(`${key('url_pattern')}(${STR})`, 'g'))) {
      const u = unquote(b[1]);
      calls.push({ path: u, method: GRPC_PATH.test(u) || /grpc/.test(seg) ? 'POST' : method, line: at.line });
    }
  });
  return { routes, calls };
}
