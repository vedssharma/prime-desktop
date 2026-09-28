import test from 'node:test';
import assert from 'node:assert/strict';
import { groupConversation } from '../src/trace.js';
import type { Message } from '../shared/types.js';

const msg = (id: string, role: Message['role'], content = id): Message => ({ id, role, content, ...(role === 'tool' ? { toolName: 'ipython' } : {}) });
const shape = (messages: Message[]) => groupConversation(messages).map(item => item.kind === 'trace' ? item.steps.map(step => step.id) : item.message.id);

test('folds a turn of tool calls and interim narration into one trace', () => {
  assert.deepEqual(shape([msg('u1', 'user'), msg('a1', 'assistant'), msg('t1', 'tool'), msg('a2', 'assistant'), msg('t2', 'tool'), msg('t3', 'tool'), msg('a3', 'assistant')]), ['u1', 'a1', ['t1', 'a2', 't2', 't3'], 'a3']);
});

test('keeps each turn separate and leaves tool-free turns untouched', () => {
  assert.deepEqual(shape([msg('u1', 'user'), msg('t1', 'tool'), msg('u2', 'user'), msg('a2', 'assistant'), msg('u3', 'user'), msg('t3', 'tool'), msg('t4', 'tool')]), ['u1', ['t1'], 'u2', 'a2', 'u3', ['t3', 't4']]);
});

test('handles empty input, tool-free history, and tools before the first prompt', () => {
  assert.deepEqual(groupConversation([]), []);
  assert.deepEqual(shape([msg('s1', 'system'), msg('a1', 'assistant')]), ['s1', 'a1']);
  assert.deepEqual(shape([msg('t0', 'tool'), msg('a0', 'assistant'), msg('u1', 'user')]), [['t0'], 'a0', 'u1']);
  const trace = groupConversation([msg('u1', 'user'), msg('t1', 'tool'), msg('t2', 'tool')])[1];
  assert.equal(trace.kind === 'trace' && trace.id, 'trace-t1');
});
