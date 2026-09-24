import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { PrimeService } from './prime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devURL = !app.isPackaged ? process.env.PRIME_DESKTOP_DEV_URL : undefined;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Unexpected development URL');
let service: PrimeService;
let window: BrowserWindow | null = null;

function text(value: unknown, field: string, max = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}
async function directory(value: unknown): Promise<string> {
  const candidate = text(value, 'directory', 4096);
  if (!path.isAbsolute(candidate) || !(await stat(candidate)).isDirectory()) throw new Error('Choose an existing absolute directory.');
  return candidate;
}
function registerIPC() {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(`prime:${name}`, (event, ...args) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted IPC sender');
      }
      return fn(...args);
    });
  };
  handle('status', () => service.status());
  handle('connect', () => service.connect());
  handle('listSessions', () => service.listSessions());
  handle('listModels', () => service.listModels());
  handle('getMessages', (id) => service.getMessages(text(id, 'session ID', 4096)));
  handle('createSession', async (value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid session');
    const input = value as Record<string, unknown>;
    return service.createSession({ prompt: text(input.prompt, 'prompt'), cwd: await directory(input.cwd),
      model: input.model === undefined ? undefined : text(input.model, 'model', 512) });
  });
  handle('sendMessage', (id, message) => service.sendMessage(text(id, 'session ID', 4096), text(message, 'message')));
  handle('interruptSession', (id) => service.interruptSession(text(id, 'session ID', 4096)));
  handle('renameSession', (id, title) => service.renameSession(text(id, 'session ID', 4096), text(title, 'title', 200)));
  handle('deleteSession', (id) => service.deleteSession(text(id, 'session ID', 4096)));
  handle('chooseDirectory', async () => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { title: 'Choose a workspace', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('openDirectory', async (value) => {
    const error = await shell.openPath(await directory(value));
    if (error) throw new Error(error);
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 760, minHeight: 560,
    title: 'Prime Desktop', backgroundColor: '#f6f7f3',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 21 },
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol)) void shell.openExternal(url); } catch { /* Ignore invalid URLs. */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { window = null; });
  if (devURL) void window.loadURL(devURL);
  else void window.loadFile(path.join(here, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(() => {
    service = new PrimeService();
    registerIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  // Detach this UI only. The CLI daemon and resident sessions stay alive.
  app.on('before-quit', () => service?.close());
}
