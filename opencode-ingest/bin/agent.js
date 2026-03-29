#!/usr/bin/env node

/**
 * Conversational Agent CLI
 *
 * Usage:
 *   node bin/agent.js afip              # Web UI mode (default)
 *   node bin/agent.js afip --cli        # Terminal mode (stdin/stdout)
 *   node bin/agent.js afip --port=4000  # Custom port
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');

const [taskName, ...flags] = process.argv.slice(2);
const isCLI = flags.includes('--cli');
const port = parseInt((flags.find(f => f.startsWith('--port=')) || '').split('=')[1]) || 3456;

if (!taskName) {
  console.log(`
  agent — Conversational browser agent

  Usage:
    agent <vendor>              Start agent with web UI
    agent <vendor> --cli        Terminal mode
    agent <vendor> --port=4000  Custom port

  Vendors: afip
  `);
  process.exit(1);
}

const dataDir = join(DATA_DIR, `agent-${taskName}`);
mkdirSync(dataDir, { recursive: true });

// Load the right interface
let agent;
if (isCLI) {
  const { AgentCLI } = await import('../agent/server.js');
  agent = await new AgentCLI().start();
} else {
  const { AgentServer } = await import('../agent/server.js');
  agent = await new AgentServer({ port }).start();
  // Open browser to UI
  const { exec } = await import('child_process');
  exec(`open http://localhost:${port}`);
}

// Load vendor
const vendors = {
  afip: () => import('../vendors/afip/fetch.js').then(m => m.fetchAFIP(agent, dataDir)),
};

if (!vendors[taskName]) {
  console.error(`Unknown vendor: ${taskName}. Available: ${Object.keys(vendors).join(', ')}`);
  process.exit(1);
}

try {
  await vendors[taskName]();
} catch (err) {
  agent.say(`Fatal error: ${err.message}`);
}

if (isCLI) {
  agent.stop();
  process.exit(0);
}
// Web UI stays alive
