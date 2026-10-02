import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard, Notification } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { validateConfig, text, directory } from './ipc-validation.js';
import { PrimeService } from './prime.js';
import { promptCommand } from './attachments.js';
import { listWorkspace, readWorkspaceFile, saveWorkspaceFile, workspaceChanges, workspaceDiff } from './workspace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devURL = !app.isPackaged ? process.env.PRIME_DESKTOP_DEV_URL : undefined;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Unexpected development URL');
let service: PrimeService;
let connectionConfig = { executable: '', socketPath: '' };
function createService() {
  return new PrimeService({ desktopDir: path.join(app.getPath('userData'), 'owned-sessions'), executable: connectionConfig.executable || undefined, socketPath: connectionConfig.socketPath || undefined,
    // Owned-session output is pushed as it streams; only the trusted main window receives it.
    onEvent: event => { if (window && !window.isDestroyed()) window.webContents.send('prime:session-event', event); },
    trash: file => shell.trashItem(file) });
}

let window: BrowserWindow | null = null;
let configuring = false;

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
    const command = promptCommand(input.prompt, input.images);
    const cwd = await directory(input.cwd);
    if (configuring) throw new Error('Connection settings changed before session creation. Try again.');
    return service.createSession({ prompt: command.message, cwd,
      model: input.model === undefined ? undefined : text(input.model, 'model', 512), allowFileChanges: input.allowFileChanges === true, images: command.images });
  });
  handle('setSessionModel', (id, model) => service.setSessionModel(text(id, 'session ID', 4096), text(model, 'model', 512)));
  handle('closeOwnedSession', id => service.closeOwnedSession(text(id, 'session ID', 4096)));
  handle('resumeOwnedSession', (id, consent) => service.resumeOwnedSession(text(id, 'session ID', 4096), consent === true));
  handle('forkOwnedSession', (id, consent, entryId) => service.forkOwnedSession(text(id, 'session ID', 4096), consent === true, entryId === undefined ? undefined : text(entryId, 'message ID', 256)));
  handle('sendMessage', (id, message, images) => {
    const command = promptCommand(message, images);
    return service.sendMessage(text(id, 'session ID', 4096), command.message, command.images);
  });
  handle('interruptSession', (id) => service.interruptSession(text(id, 'session ID', 4096)));
  handle('getSessionUsage', (id) => service.getSessionUsage(text(id, 'session ID', 4096)));
  handle('compactSession', (id, instructions) => service.compactSession(text(id, 'session ID', 4096), instructions === undefined || instructions === '' ? undefined : text(instructions, 'instructions', 16 * 1024)));
  handle('renameSession', (id, title) => service.renameSession(text(id, 'session ID', 4096), text(title, 'title', 200)));
  handle('deleteSession', (id) => service.deleteSession(text(id, 'session ID', 4096)));
  handle('setSessionArchived', (id, archived) => {
    if (typeof archived !== 'boolean') throw new Error('Invalid archive state');
    return service.setOwnedArchived(text(id, 'session ID', 4096), archived);
  });
  handle('chooseDirectory', async () => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, { title: 'Choose a workspace', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  // The renderer names a session, never a directory: the root always comes from the session record.
  const findSession = async (id: unknown) => {
    const sessionId = text(id, 'session ID', 4096);
    const session = (await service.listSessions()).find(item => item.id === sessionId);
    if (!session) throw new Error('Session not found.');
    return session;
  };
  const sessionRoot = async (id: unknown) => directory((await findSession(id)).cwd);
  const relativePath = (value: unknown) => value === undefined || value === '' ? '' : text(value, 'path', 4096);
  handle('workspaceList', async (id, relative) => listWorkspace(await sessionRoot(id), relativePath(relative)));
  handle('workspaceRead', async (id, relative) => readWorkspaceFile(await sessionRoot(id), text(relative, 'path', 4096)));
  handle('workspaceSave', async (id, relative, content, hash) => {
    // Editing needs the explicit workspace trust given when a desktop-owned session was created;
    // shared CLI sessions keep a read-only view.
    const session = await findSession(id);
    if (session.ownership !== 'desktop') throw new Error('Files can be edited only in desktop-owned sessions.');
    return saveWorkspaceFile(await directory(session.cwd), text(relative, 'path', 4096), content, hash, path.join(app.getPath('userData'), 'workspace-backups'));
  });
  handle('workspaceChanges', async (id) => workspaceChanges(await sessionRoot(id)));
  handle('workspaceDiff', async (id, relative) => workspaceDiff(await sessionRoot(id), text(relative, 'path', 4096)));
  handle('notify', (title, body, sessionId) => {
    // Only when the app is not in front; a notification for the window you are looking at is noise.
    if (!window || window.isFocused() || !Notification.isSupported()) return;
    const notification = new Notification({ title: text(title, 'title', 200), body: typeof body === 'string' ? body.slice(0, 300) : '', silent: false });
    const target = typeof sessionId === 'string' && sessionId.length <= 4096 ? sessionId : undefined;
    notification.on('click', () => {
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
      if (target) window.webContents.send('prime:notification-click', target);
    });
    notification.show();
  });
  handle('saveText', async (name, content) => {
    if (!window) return false;
    const fileName = path.basename(text(name, 'file name', 200)).replace(/[^\w. -]/g, '_');
    const data = text(content, 'content', 64 * 1024 * 1024);
    const result = await dialog.showSaveDialog(window, { title: 'Export conversation', defaultPath: path.join(app.getPath('documents'), fileName) });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data, { encoding: 'utf8', mode: 0o600 });
    return true;
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
        const result = await dialog.showMessageBox({ type: 'warning', title: 'Quit Session Dock?', message: 'Quitting stops desktop-owned agent sessions.', detail: 'Saved history remains available. Shared CLI sessions and independent agents created by tools can keep running.', buttons: ['Cancel', 'Quit and stop owned sessions'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) { quitPending = false; return; }
      }
      await service.close(); quitReady = true; app.quit();
    })().catch(() => { quitPending = false; });
  });
}
