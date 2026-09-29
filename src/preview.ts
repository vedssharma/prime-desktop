import type { PrimeAPI } from '../shared/types';
const desktopOnly = async (): Promise<never> => { throw new Error('Open Session Dock to connect to your CLI. This browser view is a UI preview only.'); };
export const previewAPI: PrimeAPI = {
  getConnectionConfig: async () => ({ executable: '', socketPath: '' }),
  configureConnection: desktopOnly,
  copyText: async (text) => navigator.clipboard.writeText(text),
  status: async () => ({ connected: false, home: '', error: 'Browser preview · Run npm run dev to connect to Prime Agent.' }),
  connect: desktopOnly,
  listSessions: async () => [],
  getMessages: async () => [],
  listModels: async () => [],
  createSession: desktopOnly,
  setSessionModel: desktopOnly,
  closeOwnedSession: desktopOnly,
  sendMessage: desktopOnly,
  interruptSession: desktopOnly,
  renameSession: desktopOnly,
  deleteSession: desktopOnly,
  chooseDirectory: desktopOnly,
  openDirectory: desktopOnly,
  workspaceList: desktopOnly,
  workspaceRead: desktopOnly,
  workspaceSave: desktopOnly,
  workspaceChanges: desktopOnly,
  workspaceDiff: desktopOnly,
  notify: async () => {},
  onNotificationClick: () => () => {},
  saveText: async (name, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
};
