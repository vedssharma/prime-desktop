export interface Session {
  id: string;
  title: string;
  cwd: string;
  model: string;
  status: 'idle' | 'running' | 'error';
  updatedAt: string;
  createdAt: string;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp?: string;
  toolName?: string;
}
export interface ModelOption { id: string; name: string; }
export interface ConnectionStatus {
  connected: boolean;
  readOnly?: boolean;
  safetyReason?: string;
  version?: string;
  error?: string;
  home: string;
}
export interface CreateSessionInput { prompt: string; cwd: string; model?: string; }
export interface ConnectionConfig { executable: string; socketPath: string; }
export interface PrimeAPI {
  getConnectionConfig(): Promise<ConnectionConfig>;
  configureConnection(config: ConnectionConfig): Promise<void>;
  status(): Promise<ConnectionStatus>;
  connect(): Promise<ConnectionStatus>;
  listSessions(): Promise<Session[]>;
  getMessages(id: string): Promise<Message[]>;
  listModels(): Promise<ModelOption[]>;
  createSession(input: CreateSessionInput): Promise<Session>;
  sendMessage(id: string, text: string): Promise<void>;
  interruptSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  copyText(text: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  openDirectory(path: string): Promise<void>;
}
declare global { interface Window { prime: PrimeAPI; } }
