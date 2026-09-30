import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyThroughMessage } from '../electron/history-fork.js';
const header = {type:'session',version:3,id:'session',cwd:'/workspace'};
const entry = (id:string, parentId:string|null, role='user', content:unknown='text') => ({type:'message',id,parentId,message:{role,content}});
const encode = (...entries:unknown[]) => [header,...entries].map(value=>JSON.stringify(value)).join('\n')+'\n';
test('snapshot contains only current ancestry through selected message', () => {
 const contents=encode(entry('a',null),entry('other','a'),entry('b','a','assistant'),entry('c','b'));
 assert.deepEqual(historyThroughMessage(contents,'b').trim().split('\n').map(line=>JSON.parse(line).id),['session','a','b']);
 assert.throws(()=>historyThroughMessage(contents,'other'), /current saved branch/);
});
test('reject ambiguous, cyclic, broken and non-message targets',()=>{
 assert.throws(()=>historyThroughMessage(encode(entry('a',null),entry('a',null)),'a'),/Ambiguous/);
 assert.throws(()=>historyThroughMessage(encode(entry('a','a')),'a'),/Cyclic/);
 assert.throws(()=>historyThroughMessage(encode(entry('a','missing')),'a'),/Broken/);
 assert.throws(()=>historyThroughMessage(encode(entry('a',null,'toolResult')),'a'),/Select/);
 assert.throws(()=>historyThroughMessage(encode(entry('a',null,'assistant',[{type:'toolCall'}])),'a'),/tool calls/);
});
