// gRPC: every rpc in a .proto service is an HTTP/2 POST to /<package>.<Service>/<Method>. That address is put on
// the Go method that implements it (a type embedding Unimplemented<Service>Server), and Go code that builds a
// New<Service>Client and calls .<Method>( gets a call to it, so the existing matcher draws the edges. A service
// nobody in the scan implements keeps its routes on the .proto file, so callers still land somewhere.
// ponytail: Go servers and clients only; add other languages when a codebase needs them.

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
const lineAt = (src, i) => src.slice(0, i).split('\n').length;

/** Services in one .proto file: [{ name, pkg, file, rpcs: [{ name, line }] }] */
export function protoServices(src, file) {
  const code = strip(src);
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1];
  const out = [];
  for (const s of code.matchAll(/\bservice\s+(\w+)\s*\{/g)) {
    // body up to the brace that closes the service (rpc options can nest braces)
    let depth = 1, i = s.index + s[0].length;
    for (; i < code.length && depth; i++) depth += code[i] === '{' ? 1 : code[i] === '}' ? -1 : 0;
    const start = s.index + s[0].length;
    const rpcs = [...code.slice(start, i).matchAll(/\brpc\s+(\w+)\s*\(/g)].map((m) => ({ name: m[1], line: lineAt(code, start + m.index) }));
    out.push({ name: s[1], pkg, file, rpcs });
  }
  return out;
}

/**
 * Adds gRPC routes (pushed to `routes`) and client calls (added to each Go file's `calls`).
 * @param files scan files ({ path, lang, calls })
 * @param routes the scan's routes, added to
 * @param read (path) => file text, '' when it can't be read
 * @returns { services, implemented, clients } counts for the summary
 */
export function grpcRoutes(files, routes, read) {
  const services = new Map(); // service name -> [{ name, pkg, file, rpcs }] (vendored copies share a name)
  for (const f of files) if (f.lang === 'protobuf' && !f.tooLarge) for (const s of protoServices(read(f.path), f.path)) {
    if (!s.pkg || !s.rpcs.length) continue;
    if (!services.has(s.name)) services.set(s.name, []);
    services.get(s.name).push(s);
  }
  if (!services.size) return { services: 0, implemented: 0, clients: 0 };
  const addr = (svc, rpc) => `/${svc.pkg}.${svc.name}/${rpc}`;
  const goFiles = files.filter((f) => f.lang === 'go' && !f.tooLarge && !/\.pb(\.gw)?\.go$|_grpc\.pb\.go$/.test(f.path));
  const src = new Map(goFiles.map((f) => [f.path, read(f.path)]));
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);

  // servers: type T struct { ...Unimplemented<Svc>Server } in a dir -> T's methods in that dir answer <Svc>
  const servers = new Map(); // `${dir}|${type}` -> service name
  for (const f of goFiles) for (const m of src.get(f.path).matchAll(/\btype\s+(\w+)\s+struct\s*\{([^}]*)\}/g)) {
    const svc = /\bUnimplemented(\w+)Server\b/.exec(m[2])?.[1];
    if (svc && services.has(svc)) servers.set(`${dirOf(f.path)}|${m[1]}`, svc);
  }
  const implemented = new Set();
  for (const f of goFiles) for (const m of src.get(f.path).matchAll(/^func\s*\(\s*\w*\s*\*?\s*(\w+)\s*\)\s*(\w+)\s*\(/gm)) {
    const svcName = servers.get(`${dirOf(f.path)}|${m[1]}`);
    const svc = svcName && services.get(svcName)[0];
    if (!svc?.rpcs.some((r) => r.name === m[2])) continue;
    routes.push({ file: f.path, method: 'POST', path: addr(svc, m[2]), line: lineAt(src.get(f.path), m.index), handler: m[2], framework: 'grpc' });
    implemented.add(svcName);
  }
  for (const [name, copies] of services) if (!implemented.has(name)) for (const s of copies) for (const r of s.rpcs)
    routes.push({ file: s.file, method: 'POST', path: addr(s, r.name), line: r.line, handler: r.name, framework: 'grpc' });

  // generated stubs spell every address out as a string; they're plumbing, not callers
  const addrs = new Set(routes.filter((r) => r.framework === 'grpc').map((r) => r.path));
  for (const f of files) if (/\.pb(\.gw)?\.go$/.test(f.path) && f.calls) f.calls = f.calls.filter((c) => !addrs.has(c.path));

  // clients: New<Svc>Client( in a file, then .<Method>( calls in it
  let clients = 0;
  for (const f of goFiles) {
    const code = src.get(f.path);
    for (const m of code.matchAll(/\bNew(\w+)Client\s*\(/g)) {
      const svc = services.get(m[1])?.[0];
      if (!svc) continue;
      clients++;
      for (const r of svc.rpcs) {
        const call = new RegExp(`\\.${r.name}\\s*\\(\\s*ctx|\\.${r.name}\\s*\\(\\s*context\\.`).exec(code);
        if (call) f.calls = [...(f.calls || []), { path: addr(svc, r.name), method: 'POST', line: lineAt(code, call.index) }];
      }
    }
  }
  return { services: services.size, implemented: implemented.size, clients };
}
