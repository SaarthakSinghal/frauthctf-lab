const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const workspace = process.env.WORKSPACE_ID || 'local-p001';
const stateFile = path.join('/state', 'workspace.json');
fs.mkdirSync('/state', { recursive: true });

if (!fs.existsSync(stateFile)) {
  fs.writeFileSync(stateFile, JSON.stringify({
    workspace,
    started: new Date().toISOString()
  }));
}
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
if (state.workspace !== workspace) {
  throw new Error('State belongs to a different workspace');
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health/live') return res.end(JSON.stringify({ ok: true }));
  if (req.url === '/health/ready') return res.end(JSON.stringify({ ready: true }));
  if (req.url === '/') return res.end(JSON.stringify(state));
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});
server.listen(8080, '0.0.0.0', () => {
  console.log('ready workspace=' + workspace + ' port=8080');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
