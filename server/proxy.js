#!/usr/bin/env node
// Catch all errors immediately
process.on('uncaughtException', e => { console.error('UNCAUGHT:', e); });
process.on('unhandledRejection', e => { console.error('UNHANDLED:', e); });
console.log('Proxy starting... Node ' + process.version + ' PID ' + process.pid);
console.log('ENV: INSTANCES=' + process.env.INSTANCES + ' PORT=' + process.env.PORT);
/**
 * Multi-instance OpenCode proxy.
 *
 * Runs N OpenCode instances on internal ports and proxies requests
 * with sticky session routing (user → consistent instance).
 *
 * Config via environment:
 *   INSTANCES=3          — number of OpenCode instances (default: 3)
 *   PORT=8080            — external port (default: 8080)
 *   BASE_PORT=9001       — first internal port (default: 9001)
 *   CORS_ORIGINS=https://palindrome-exercise.vercel.app
 */

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

const INSTANCES = parseInt(process.env.INSTANCES || '3');
const PORT = parseInt(process.env.PORT || '8080');
const BASE_PORT = parseInt(process.env.BASE_PORT || '9001');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://palindrome-exercise.vercel.app,https://miguelemosreverte.github.io').split(',');

const instances = [];

// ─── Start OpenCode instances ───

function startInstance(index) {
  const port = BASE_PORT + index;
  const workdir = `/workspaces/pool-${index}`;
  const dataDir = `/data/pool-${index}`;

  // Ensure directories exist
  const { execSync } = require('child_process');
  try { execSync(`mkdir -p ${workdir} ${dataDir}`); } catch {}

  const env = {
    ...process.env,
    HOME: dataDir,
    XDG_DATA_HOME: `${dataDir}/.local/share`,
    XDG_CONFIG_HOME: `${dataDir}/.config`,
  };

  const proc = spawn('/usr/local/bin/opencode', [
    'serve',
    '--port', String(port),
    '--hostname', '127.0.0.1',
    '--print-logs',
    '--cors', ...CORS_ORIGINS,
  ], {
    cwd: workdir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => process.stdout.write(`[${index}] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[${index}] ${d}`));

  proc.on('exit', (code) => {
    console.error(`[${index}] OpenCode exited with code ${code}, restarting in 3s...`);
    setTimeout(() => {
      instances[index] = startInstance(index);
    }, 3000);
  });

  return { port, proc, workdir, healthy: false, index };
}

// ─── Health checking ───

async function checkHealth(instance) {
  try {
    const res = await fetch(`http://127.0.0.1:${instance.port}/global/health`, { signal: AbortSignal.timeout(2000) });
    instance.healthy = res.ok;
  } catch {
    instance.healthy = false;
  }
}

async function healthLoop() {
  while (true) {
    await Promise.all(instances.map(checkHealth));
    const healthy = instances.filter(i => i.healthy).length;
    if (healthy !== instances.length) {
      console.log(`Health: ${healthy}/${instances.length} instances ready`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

// ─── Routing ───

function hashToInstance(key) {
  const hash = crypto.createHash('md5').update(key).digest();
  const healthyInstances = instances.filter(i => i.healthy);
  if (!healthyInstances.length) return instances[0]; // fallback
  return healthyInstances[hash.readUInt32LE(0) % healthyInstances.length];
}

function getRoutingKey(req) {
  // Try to extract user identity from: cookie, header, session path, or IP
  const sessionMatch = req.url.match(/\/session\/(ses_[a-zA-Z0-9]+)/);
  if (sessionMatch) return sessionMatch[1]; // Stick to same instance for a session

  const cookie = req.headers.cookie?.match(/oc_route=([^;]+)/)?.[1];
  if (cookie) return cookie;

  const forwarded = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  return forwarded || 'default';
}

// ─── Proxy ───

const server = http.createServer(async (req, res) => {
  // CORS
  const origin = req.headers.origin;
  if (CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Access-Token,X-Demo-Session');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health endpoint for Railway
  if (req.url === '/health' || req.url === '/proxy/health') {
    const healthy = instances.filter(i => i.healthy).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      instances: instances.length,
      healthy,
      details: instances.map(i => ({ index: i.index, port: i.port, healthy: i.healthy, workdir: i.workdir })),
    }));
    return;
  }

  // Proxy status
  if (req.url === '/proxy/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      instances: instances.length,
      healthy: instances.filter(i => i.healthy).length,
      uptime: process.uptime(),
    }));
    return;
  }

  // Route to instance
  const routeKey = getRoutingKey(req);
  const instance = hashToInstance(routeKey);

  if (!instance.healthy) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No healthy instances available' }));
    return;
  }

  // Set sticky cookie
  res.setHeader('Set-Cookie', `oc_route=${routeKey}; Path=/; SameSite=Lax`);

  // Forward request
  const target = `http://127.0.0.1:${instance.port}`;
  const proxyReq = http.request(target + req.url, {
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${instance.port}` },
    timeout: 180000, // 3 min for long tool executions
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error(`[proxy] Error forwarding to instance ${instance.index}: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Instance unavailable', instance: instance.index }));
    }
  });

  req.pipe(proxyReq);
});

// ─── SSE proxy (special handling for EventSource) ───
// The /event endpoint uses SSE which needs long-lived connections
// The default proxy above handles this via pipe()

// ─── Start everything ───

console.log(`Starting ${INSTANCES} OpenCode instances...`);
for (let i = 0; i < INSTANCES; i++) {
  instances.push(startInstance(i));
}

// Start listening IMMEDIATELY so Railway health checks pass
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nProxy listening on http://0.0.0.0:${PORT}`);
  console.log(`Instances: ${instances.map(i => `#${i.index} :${i.port}`).join(', ')}`);
  console.log(`CORS: ${CORS_ORIGINS.join(', ')}`);
});

// Start health checking after instances have time to boot
setTimeout(healthLoop, 5000);
