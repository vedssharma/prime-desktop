import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAPI } from '../src/preview.js';

test('browser preview reads as disconnected and refuses every desktop-only action', async () => {
  const status = await previewAPI.status();
  assert.equal(status.connected, false);
  assert.match(status.error ?? '', /Browser preview/);
  assert.deepEqual(await previewAPI.getConnectionConfig(), { executable: '', socketPath: '' });
  assert.deepEqual(await previewAPI.listSessions(), []);
  assert.deepEqual(await previewAPI.getMessages('any'), []);
  assert.deepEqual(await previewAPI.listModels(), []);
  const refused = ['configureConnection', 'connect', 'createSession', 'setSessionModel', 'closeOwnedSession', 'resumeOwnedSession', 'forkOwnedSession', 'sendMessage', 'interruptSession', 'getSessionUsage', 'compactSession', 'renameSession', 'deleteSession', 'setSessionArchived', 'chooseDirectory', 'openDirectory', 'workspaceList', 'workspaceRead', 'workspaceSave', 'workspaceChanges', 'workspaceDiff'] as const;
  for (const method of refused) await assert.rejects((previewAPI[method] as (...args: unknown[]) => Promise<unknown>)('id', 'value'), /Open Session Dock to connect/, method);
  assert.deepEqual(Object.keys(previewAPI).filter(key => ![...refused, 'status', 'getConnectionConfig', 'listSessions', 'getMessages', 'listModels', 'copyText', 'saveText', 'notify', 'onNotificationClick'].includes(key)), [], 'new bridge methods need a preview decision');
});
