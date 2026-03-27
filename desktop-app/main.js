const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let agentProcess = null;
let agentStatus = 'stopped';

// ─── Session management ───
// Session is read from ~/.bridge/session (created by bridge-daemon or manually).
// This is the single source of truth shared by desktop, agent, CLI, and phone.

const SESSION_PATH = path.join(process.env.HOME || '', '.bridge', 'session');

function getSession() {
  try { return fs.readFileSync(SESSION_PATH, 'utf8').trim(); }
  catch (e) { return ''; }
}

function saveSession(id) {
  var dir = path.dirname(SESSION_PATH);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  fs.writeFileSync(SESSION_PATH, id);
}

// Expose to renderer via IPC — this is synchronous and reliable
ipcMain.handle('get-session', () => getSession());
ipcMain.handle('save-session', (event, id) => { saveSession(id); return true; });
ipcMain.handle('agent-status', () => agentStatus);

// ─── Agent ───

function spawnAgent() {
  var script = path.join(__dirname, '..', 'scripts', 'bridge-agent.sh');
  agentProcess = spawn('bash', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  agentStatus = 'running';
  agentProcess.stdout.on('data', (d) => process.stdout.write('[agent] ' + d));
  agentProcess.stderr.on('data', (d) => process.stderr.write('[agent:err] ' + d));
  agentProcess.on('error', () => { agentStatus = 'error'; });
  agentProcess.on('exit', (code) => {
    agentStatus = code === 0 ? 'stopped' : 'error';
    agentProcess = null;
  });
}

// ─── Window ───

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
