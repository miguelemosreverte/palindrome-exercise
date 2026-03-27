const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const crypto = require('crypto');

const VERCEL_URL = 'https://palindrome-exercise.vercel.app';
let mainWindow = null;
let tray = null;
let sessionId = null;

async function createSession() {
  const { default: fetch } = await import('node-fetch').catch(() => {
    // Electron has fetch built-in in recent versions
    return { default: globalThis.fetch };
  });
  const res = await fetch(`${VERCEL_URL}/api/bridge/sessions`, { method: 'POST' });
  const data = await res.json();
  return data.sessionId;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Bridge',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Simple tray icon (1x1 pixel, will show as dot)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('Bridge');
  tray.setToolTip('Bridge — Desktop ↔ Phone');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Bridge', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
