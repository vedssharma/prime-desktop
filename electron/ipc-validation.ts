import path from 'node:path';
import { stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';

/** Renderer input is untrusted: validate every IPC argument before it reaches the service. */
export async function validateConfig(value: unknown) {
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
export function text(value: unknown, field: string, max = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}
export async function directory(value: unknown): Promise<string> {
  const candidate = text(value, 'directory', 4096);
  if (!path.isAbsolute(candidate) || !(await stat(candidate)).isDirectory()) throw new Error('Choose an existing absolute directory.');
  return candidate;
}
