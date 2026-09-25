import { contextBridge, ipcRenderer } from 'electron';
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
  createSession: (input: { prompt: string; cwd: string; model?: string; allowFileChanges?: boolean }) => invoke('createSession', input),
  setSessionModel: (id: string, model: string) => invoke('setSessionModel', id, model),
  closeOwnedSession: (id: string) => invoke('closeOwnedSession', id),
  sendMessage: (id: string, text: string) => invoke('sendMessage', id, text),
  interruptSession: (id: string) => invoke('interruptSession', id),
  renameSession: (id: string, title: string) => invoke('renameSession', id, title),
  deleteSession: (id: string) => invoke('deleteSession', id),
  chooseDirectory: () => invoke('chooseDirectory'),
  openDirectory: (path: string) => invoke('openDirectory', path),
}));
