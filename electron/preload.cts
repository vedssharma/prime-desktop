import { contextBridge, ipcRenderer } from 'electron';
import type { ImageAttachment } from './attachments.js';
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke(`prime:${method}`, ...args);
contextBridge.exposeInMainWorld('prime', Object.freeze({
  getConnectionConfig: () => invoke('getConnectionConfig'),
  configureConnection: (config: { executable: string; socketPath: string }) => invoke('configureConnection', config),
  copyText: (text: string) => invoke('copyText', text),
  status: () => invoke('status'),
  connect: () => invoke('connect'),
  listSessions: () => invoke('listSessions'),
  getMessages: (id: string) => invoke('getMessages', id),
  listModels: () => invoke('listModels'),
  createSession: (input: { prompt: string; cwd: string; model?: string; allowFileChanges?: boolean; images?: ImageAttachment[] }) => invoke('createSession', input),
  setSessionModel: (id: string, model: string) => invoke('setSessionModel', id, model),
  closeOwnedSession: (id: string) => invoke('closeOwnedSession', id),
  sendMessage: (id: string, text: string, images?: ImageAttachment[]) => invoke('sendMessage', id, text, images),
  interruptSession: (id: string) => invoke('interruptSession', id),
  getSessionUsage: (id: string) => invoke('getSessionUsage', id),
  compactSession: (id: string, instructions?: string) => invoke('compactSession', id, instructions),
  renameSession: (id: string, title: string) => invoke('renameSession', id, title),
  deleteSession: (id: string) => invoke('deleteSession', id),
  chooseDirectory: () => invoke('chooseDirectory'),
  openDirectory: (path: string) => invoke('openDirectory', path),
  workspaceList: (id: string, path?: string) => invoke('workspaceList', id, path),
  workspaceRead: (id: string, path: string) => invoke('workspaceRead', id, path),
  workspaceSave: (id: string, path: string, content: string, hash: string) => invoke('workspaceSave', id, path, content, hash),
  workspaceChanges: (id: string) => invoke('workspaceChanges', id),
  workspaceDiff: (id: string, path: string) => invoke('workspaceDiff', id, path),
  notify: (title: string, body: string, sessionId?: string) => invoke('notify', title, body, sessionId),
  onNotificationClick: (listener: (sessionId: string) => void) => {
    const wrapped = (_event: unknown, sessionId: unknown) => { if (typeof sessionId === 'string') listener(sessionId); };
    ipcRenderer.on('prime:notification-click', wrapped);
    return () => { ipcRenderer.removeListener('prime:notification-click', wrapped); };
  },
  saveText: (suggestedName: string, content: string) => invoke('saveText', suggestedName, content),
}));
