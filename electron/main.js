// Desktop app: runs the RollScout server inside the app and shows it in a native window.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell, Menu } from 'electron';
import { startServer } from '../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let baseUrl = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function isInternal(url) {
  return baseUrl && url.startsWith(baseUrl);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 500,
    title: 'RollScout',
    icon: path.join(here, '..', 'build', 'icon.png'),
    backgroundColor: '#f6f5f2',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Platform pages and "Get a key" links open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(baseUrl);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Get a Pexels API key', click: () => shell.openExternal('https://www.pexels.com/api/') },
        { label: 'Get a Pixabay API key', click: () => shell.openExternal('https://pixabay.com/api/docs/') },
        { label: 'Get an Unsplash API key', click: () => shell.openExternal('https://unsplash.com/developers') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  // Port 0 lets the system pick a free port, so the app never clashes with anything else.
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('before-quit', () => server.close());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
