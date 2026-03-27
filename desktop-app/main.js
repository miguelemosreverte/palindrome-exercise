const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow = null;
let agentProcess = null;
let agentStatus = 'stopped'; // 'stopped' | 'running' | 'error'

function spawnAgent() {
  const script = path.join(__dirname, '..', 'scripts', 'bridge-agent.sh');

  // Try opencode first, fall back to claude
  agentProcess = spawn('bash', [script, 'opencode'], { stdio: ['ignore', 'pipe', 'pipe'] });
  agentStatus = 'running';

  agentProcess.stdout.on('data', (d) => process.stdout.write(`[agent] ${d}`));
  agentProcess.stderr.on('data', (d) => process.stderr.write(`[agent:err] ${d}`));

  agentProcess.on('error', () => {
    agentStatus = 'error';
  });

  agentProcess.on('exit', (code) => {
    if (code !== 0 && agentStatus === 'running') {
      // Retry with claude
      console.log('[agent] opencode exited, falling back to claude...');
      agentProcess = spawn('bash', [script, 'claude'], { stdio: ['ignore', 'pipe', 'pipe'] });
      agentProcess.stdout.on('data', (d) => process.stdout.write(`[agent] ${d}`));
      agentProcess.stderr.on('data', (d) => process.stderr.write(`[agent:err] ${d}`));
      agentProcess.on('exit', (c) => {
        agentStatus = c === 0 ? 'stopped' : 'error';
        agentProcess = null;
      });
    } else {
      agentStatus = code === 0 ? 'stopped' : 'error';
      agentProcess = null;
    }
  });
}

ipcMain.handle('agent-status', () => agentStatus);

// Read persisted session from ~/.bridge/session
const fs = require('fs');
function getPersistedSession() {
  var locations = [
    path.join(process.env.HOME || '', '.bridge', 'session'),
    path.join(process.env.HOME || '', '.bridge-session'),
  ];
  for (var i = 0; i < locations.length; i++) {
    try {
      var s = fs.readFileSync(locations[i], 'utf8').trim();
      if (s) return s;
    } catch (e) {}
  }
  return null;
}
ipcMain.handle('get-session', () => getPersistedSession());

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Bridge',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#bcecff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  spawnAgent();
});

app.on('window-all-closed', () => {
  if (agentProcess) agentProcess.kill();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
