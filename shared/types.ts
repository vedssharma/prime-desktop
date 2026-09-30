import type { ImageAttachment } from '../electron/attachments';
export type { ImageAttachment } from '../electron/attachments';
export interface Session {
  id: string;
  title: string;
  cwd: string;
  model: string;
  status: 'idle' | 'running' | 'error';
  updatedAt: string;
  createdAt: string;
  ownership?: 'shared' | 'desktop';
  writable?: boolean;
  lifecycle?: 'open' | 'closed';
  /** Follow-ups the agent reports as queued. Only present when the agent reports it (desktop-owned sessions). */
  queuedCount?: number;
  supportsImages?: boolean;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp?: string;
  toolName?: string;
  images?: ImageAttachment[];
}
export interface SessionUsage {
  userMessages: number; assistantMessages: number; toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  /** Null values mean the agent has no estimate yet, for example right after compaction. */
  context?: { tokens: number | null; contextWindow: number | null; percent: number | null };
}
export interface ModelOption { id: string; name: string; }
export interface ConnectionStatus {
  connected: boolean;
  readOnly?: boolean;
  canCreateOwned?: boolean;
  ownedReason?: string;
  safetyReason?: string;
  version?: string;
  error?: string;
  home: string;
}
export interface CreateSessionInput { prompt: string; cwd: string; model?: string; allowFileChanges?: boolean; images?: ImageAttachment[]; }
export interface ConnectionConfig { executable: string; socketPath: string; }
export interface WorkspaceEntry { name: string; type: 'file' | 'dir' | 'link'; size: number }
export interface WorkspaceListing { path: string; entries: WorkspaceEntry[]; truncated: boolean }
export interface WorkspaceFile { path: string; size: number; binary: boolean; truncated: boolean; content: string; hash?: string; editable: boolean }
export interface WorkspaceSaveResult { file: WorkspaceFile; backup: string }
export interface WorkspaceChange { path: string; status: string; label: string }
export interface WorkspaceChanges { isRepo: boolean; changes: WorkspaceChange[]; truncated: boolean; error?: string }
export interface WorkspaceDiff { path: string; diff: string; truncated: boolean }
export interface PrimeAPI {
  getConnectionConfig(): Promise<ConnectionConfig>;
  configureConnection(config: ConnectionConfig): Promise<void>;
  status(): Promise<ConnectionStatus>;
  connect(): Promise<ConnectionStatus>;
  listSessions(): Promise<Session[]>;
  getMessages(id: string): Promise<Message[]>;
  listModels(): Promise<ModelOption[]>;
  setSessionModel(id: string, model: string): Promise<void>;
  closeOwnedSession(id: string): Promise<void>;
  resumeOwnedSession(id: string, allowFileChanges: boolean): Promise<Session>;
  forkOwnedSession(id: string, allowFileChanges: boolean, entryId?: string): Promise<Session>;
  createSession(input: CreateSessionInput): Promise<Session>;
  sendMessage(id: string, text: string, images?: ImageAttachment[]): Promise<void>;
  interruptSession(id: string): Promise<void>;
  getSessionUsage(id: string): Promise<SessionUsage>;
  compactSession(id: string, instructions?: string): Promise<{ tokensBefore: number | null }>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  copyText(text: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  openDirectory(path: string): Promise<void>;
  workspaceList(id: string, path?: string): Promise<WorkspaceListing>;
  workspaceRead(id: string, path: string): Promise<WorkspaceFile>;
  workspaceSave(id: string, path: string, content: string, hash: string): Promise<WorkspaceSaveResult>;
  workspaceChanges(id: string): Promise<WorkspaceChanges>;
  workspaceDiff(id: string, path: string): Promise<WorkspaceDiff>;
  notify(title: string, body: string, sessionId?: string): Promise<void>;
  onNotificationClick(listener: (sessionId: string) => void): () => void;
  saveText(suggestedName: string, content: string): Promise<boolean>;
}
declare global { interface Window { prime: PrimeAPI; } }
