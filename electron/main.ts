import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stat, readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { PrimeService } from './prime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devURL = !app.isPackaged ? process.env.PRIME_DESKTOP_DEV_URL : undefined;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Unexpected development URL');
let service: PrimeService;
let connectionConfig = { executable: '', socketPath: '' };
function createService() { return new PrimeService({ desktopDir: path.join(app.getPath('userData'), 'owned-sessions'), executable: connectionConfig.executable || undefined, socketPath: connectionConfig.socketPath || undefined }); }
async function validateConfig(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid connection settings');
  const record = value as Record<string, unknown>;
  const result = { executable: '', socketPath: '' };
  for (const key of ['executable', 'socketPath'] as const) {
    if (typeof record[key] !== 'string' || record[key].length > 4096 || record[key].includes('\0')) throw new Error(`Invalid ${key}`);
    result[key] = record[key].trim();
    if (result[key] && !path.isAbsolute(result[key])) throw new Error(`${key} must be an absolute path`);
  }
  if (result.executable) { if (!(await stat(result.executable)).isFile()) throw new Error('CLI must be a file'); await access(result.executable, constants.X_OK); }
  return result;
}

let window: BrowserWindow | null = null;
let configuring = false;

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
  handle('getConnectionConfig', () => connectionConfig);
  handle('configureConnection', async (value) => {
    if (configuring) throw new Error('Connection settings are already changing.');
    configuring = true;
    try {
      if (await service.hasOpenOwnedSessions()) throw new Error('Close desktop-owned sessions before changing connection settings. Shared CLI sessions are not affected.');
      const next = await validateConfig(value);
      const dir = app.getPath('userData'); await mkdir(dir, { recursive: true });
      const file = path.join(dir, 'connection.json');
      await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 }); await rename(file + '.tmp', file);
      connectionConfig = next; await service.close(); service = createService();
    } finally { configuring = false; }
  });
  handle('copyText', async (value) => { await clipboard.writeText(text(value, 'clipboard text', 4 * 1024 * 1024)); });
  handle('status', () => service.status());
  handle('connect', () => service.connect());
  handle('listSessions', () => service.listSessions());
  handle('listModels', () => service.listModels());
  handle('getMessages', (id) => service.getMessages(text(id, 'session ID', 4096)));
  handle('createSession', async (value) => {
    if (configuring) throw new Error('Wait for connection settings to finish changing.');
    if (!value || typeof value !== 'object') throw new Error('Invalid session');
    const input = value as Record<string, unknown>;
    const cwd = await directory(input.cwd);
    if (configuring) throw new Error('Connection settings changed before session creation. Try again.');
    return service.createSession({ prompt: text(input.prompt, 'prompt'), cwd,
      model: input.model === undefined ? undefined : text(input.model, 'model', 512), allowFileChanges: input.allowFileChanges === true });
  });
  handle('setSessionModel', (id, model) => service.setSessionModel(text(id, 'session ID', 4096), text(model, 'model', 512)));
  handle('closeOwnedSession', id => service.closeOwnedSession(text(id, 'session ID', 4096)));
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
    title: 'Session Dock', backgroundColor: '#f6f7f3',
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
  app.whenReady().then(async () => {
    try { connectionConfig = await validateConfig(JSON.parse(await readFile(path.join(app.getPath('userData'), 'connection.json'), 'utf8'))); } catch { /* Defaults recover from stale/invalid paths. */ }
    service = createService();
    registerIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    createWindow();
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let quitReady = false, quitPending = false;
  app.on('before-quit', event => {
    if (quitReady || !service) return;
    event.preventDefault(); if (quitPending) return; quitPending = true;
    void (async () => {
      if (await service.hasOpenOwnedSessions()) {
        const result = await dialog.showMessageBox({ type: 'warning', title: 'Quit Session Dock?', message: 'Quitting stops desktop-owned agent sessions.', detail: 'Their saved history remains available. Shared CLI sessions keep running.', buttons: ['Cancel', 'Quit and stop owned sessions'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) { quitPending = false; return; }
      }
      await service.close(); quitReady = true; app.quit();
    })().catch(() => { quitPending = false; });
  });
}
