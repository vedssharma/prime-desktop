import { contextBridge, ipcRenderer } from 'electron';
const invoke = (method: string, ...args: unknown[]) => ipcRenderer.invoke(`prime:${method}`, ...args);
contextBridge.exposeInMainWorld('prime', Object.freeze({
  copyText: (text: string) => invoke('copyText', text),
  status: () => invoke('status'),
  connect: () => invoke('connect'),
  listSessions: () => invoke('listSessions'),
  getMessages: (id: string) => invoke('getMessages', id),
  listModels: () => invoke('listModels'),
  createSession: (input: { prompt: string; cwd: string; model?: string }) => invoke('createSession', input),
  sendMessage: (id: string, text: string) => invoke('sendMessage', id, text),
  interruptSession: (id: string) => invoke('interruptSession', id),
  renameSession: (id: string, title: string) => invoke('renameSession', id, title),
  deleteSession: (id: string) => invoke('deleteSession', id),
  chooseDirectory: () => invoke('chooseDirectory'),
  openDirectory: (path: string) => invoke('openDirectory', path),
}));
