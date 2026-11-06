// Fault proxy for media-cleanup-faults.js: sits between real pg_net and the real Storage API on the isolated replay network. Local
// replay only; started inside a container with no route out. Each file gets a script of modes, consumed one request at a time;
// a file with no script left is passed straight through to Storage.
//   pass | <status> (answers that status, touches nothing) | not_found_400 (Storage's older "400 + statusCode 404" body, touches nothing)
//   ok_untouched (200, touches nothing) | reset (socket dropped) | hang (never answers, so pg_net times out)
// POST /__script {path, modes}; GET /__log; POST /__clear.
const http = require('http');
const target = new URL(process.env.TARGET);
let scripts = {};
let log = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const send = (status, body = '{}') => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body); };
    if (req.url === '/__log') return send(200, JSON.stringify(log));
    if (req.url === '/__clear') { scripts = {}; log = []; return send(200); }
    if (req.url === '/__script') {
      const { path, modes } = JSON.parse(Buffer.concat(chunks).toString());
      scripts[path] = modes;
      return send(200);
    }
    const name = decodeURIComponent(req.url.split('/object/stories/')[1] || '');
    const mode = (scripts[name] || []).shift() || 'pass';
    log.push({ method: req.method, url: req.url, name, mode });
    if (mode === 'hang') return undefined;
    if (mode === 'reset') return req.socket.destroy();
    if (mode === 'ok_untouched') return send(200, '{"message":"Successfully deleted"}');
    if (mode === 'not_found_400') return send(400, '{"statusCode":"404","error":"not_found","message":"Object not found"}');
    if (/^\d+$/.test(mode)) return send(Number(mode), `{"statusCode":"${mode}","error":"injected","message":"injected ${mode}"}`);
    const up = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => send(502));
    return up.end(Buffer.concat(chunks));
  });
});
server.listen(8080, '0.0.0.0');
