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
  sendMessage: desktopOnly,
  interruptSession: desktopOnly,
  renameSession: desktopOnly,
  deleteSession: desktopOnly,
  chooseDirectory: desktopOnly,
  openDirectory: desktopOnly,
};
