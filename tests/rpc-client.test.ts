import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { RpcClient, rpcEnvironment } from '../electron/rpc-client.js';
const launch = (timeoutMs = 1000) => new RpcClient({ executable: process.execPath, args: [path.resolve('tests/fixtures/rpc-child.mjs')], cwd: process.cwd(), timeoutMs });
test('owned RPC correlates replies, preserves Unicode and separates events', async () => {
 const client=launch(); const events: string[]=[]; client.onEvent(event=>events.push(event.type));
 try {
  const results=await Promise.all([client.request({type:'get_state'},false),client.request({type:'echo',value:'a\u2028b\u2029c ☃'},false)]);
  assert.equal(results[0].sessionId,'fixture');assert.equal(results[1].value,'a\u2028b\u2029c ☃');
  await client.request({type:'prompt',message:'fixture only'});assert.deepEqual(events,['agent_start']);
  await assert.rejects(client.request({type:'rejected'}),/Rejected by fixture/);
 } finally { await client.close(); } assert.equal(client.alive,false);
});
test('RPC timeout and process exit never retry ambiguous writes', async () => {
 const client=launch(100);
 try {await assert.rejects(client.request({type:'never'}),/uncertain/);await assert.rejects(client.request({type:'crash'}),/uncertain/);await assert.rejects(client.request({type:'prompt'}),/exited/);}
 finally{await client.close();}
});
test('malformed RPC data fails pending reads safely',async()=>{const client=launch();try{await assert.rejects(client.request({type:'malformed'},false),/Invalid/);}finally{await client.close();}});


test('RPC environment cannot inherit worker roles but retains native provider configuration', () => {
 const env = rpcEnvironment({ PRIME_AGENT_INTERNAL_OWNED_WORKER:'1', PRIME_AGENT_INTERNAL_DAEMON_WORKER:'1', PRIME_AGENT_INTERNAL_DAEMON_CATALOG:'1', NODE_OPTIONS:'--require injected', BUN_OPTIONS:'x', ELECTRON_RUN_AS_NODE:'1', PI_STARTUP_BENCHMARK:'1', PRIME_AGENT_CODING_AGENT_DIR:'/configured', ANTHROPIC_API_KEY:'fixture-placeholder', PATH:'/bin' });
 assert.deepEqual(env,{PRIME_AGENT_CODING_AGENT_DIR:'/configured',ANTHROPIC_API_KEY:'fixture-placeholder',PATH:'/bin'});
});

test('mismatched correlation fails the pipe while replies for unknown ids are ignored', async () => {
 const client=launch();
 try {
  assert.equal((await client.request({type:'stray',value:'real'},false)).value,'real');
  await assert.rejects(client.request({type:'mismatch'}),/Invalid or oversized response.*uncertain/);
  assert.equal(client.alive,false);
 } finally { await client.close(); }
});
test('commands are validated and bounded before they are written', async () => {
 const client=launch();
 try {
  await assert.rejects(client.request({value:'no type'}),/Invalid RPC command/);
  await assert.rejects(client.request({type:'echo',value:'x'.repeat(1024*1024)}),/1 MiB/);
  assert.equal(client.alive,true);
  assert.equal((await client.request({type:'echo',value:'still usable'},false)).value,'still usable');
 } finally { await client.close(); }
 await assert.rejects(client.request({type:'get_state'},false),/process exited/);
});
test('a missing executable reports a start failure instead of hanging', async () => {
 const client=new RpcClient({executable:path.resolve('tests/fixtures/does-not-exist'),args:[],cwd:process.cwd(),timeoutMs:1000});
 try {
  while (client.alive) await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(client.request({type:'get_state'},false),/Could not start Prime Agent RPC \(ENOENT\)/);
 } finally { await client.close(); }
});
