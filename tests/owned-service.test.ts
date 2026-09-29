import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, copyFile, chmod, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrimeService } from '../electron/prime.js';
import { fakeDaemon } from './fake-daemon.js';

test('desktop-owned pipe writes only its fixture workspace, persists history, and never routes shared mutations', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-service-')); const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const daemon=await fakeDaemon(command=>{assert.equal(command.type,'list');return {sessions:[{sessionId:'shared',activeSessionId:'mutable',cwd:'/shared'}]};});
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:daemon.socketPath});
 try {
  assert.equal((await service.status()).canCreateOwned,true);
  await assert.rejects(service.createSession({cwd:dir,prompt:'no consent'}),/Confirm/);
  const session=await service.createSession({cwd:dir,prompt:'WRITE_FIXTURE_FILE',allowFileChanges:true});
  assert.equal(session.ownership,'desktop');assert.equal(session.writable,true);
  assert.equal(await readFile(join(dir,'owned-proof.txt'),'utf8'),'written by isolated RPC fixture\n');
  assert.equal((await service.getMessages(session.id))[0].content,'WRITE_FIXTURE_FILE');
  await service.sendMessage(session.id,'follow-up');await service.interruptSession(session.id);
  await service.setSessionModel(session.id,'fixture/org/nested');
  assert.equal((await service.listSessions()).find(s=>s.id===session.id)?.model,'fixture/org/nested');
  await service.renameSession(session.id,'Owned title');
  await assert.rejects(service.sendMessage('shared','no'),/Read-only compatibility/);
  await assert.rejects(service.deleteSession(session.id),/Read-only compatibility/);
  await service.closeOwnedSession(session.id);
  await assert.rejects(service.sendMessage(session.id,'no'),/closed/);
  assert.equal((await service.getMessages(session.id)).length,1); // fixture writes independent branch per turn
  assert(daemon.commands.every(command=>command.type==='list'));
  await service.close();
  const reopened=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:daemon.socketPath});
  try { const history=(await reopened.listSessions()).find(s=>s.id===session.id)!;assert.equal(history.title,'Owned title');assert.equal(history.writable,false);assert.equal(history.lifecycle,'closed'); }
  finally{await reopened.close();}
 }finally{await service.close();await daemon.close();await rm(dir,{recursive:true,force:true});}
});


test('accepted owned prompt remains successful when subsequent state reads fail', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-admission-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent')});
 try {
  const session=await service.createSession({cwd:dir,prompt:'First',allowFileChanges:true});
  await assert.doesNotReject(service.sendMessage(session.id,'ACCEPT_THEN_FAIL_READ'));
  await assert.rejects(service.getMessages(session.id),/Read failed/);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});

test('shutdown tracks creation before startup preflights finish', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-shutdown-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent')});
 try {
  const creation=service.createSession({cwd:dir,prompt:'Must not start',allowFileChanges:true});
  const rejection=assert.rejects(creation,/closing/);
  await service.close();await rejection;assert.equal(await service.hasOpenOwnedSessions(),false);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});

test('accepted follow-ups persist owned-session activity across a relaunch', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-activity-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const options={executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent')};
 const service=new PrimeService(options);
 try {
  const session=await service.createSession({cwd:dir,prompt:'  First line\n\n  second\tline ',allowFileChanges:true});
  assert.equal(session.title,'First line second line');
  await new Promise(resolve=>setTimeout(resolve,20));
  await service.sendMessage(session.id,'Later follow-up');
  const live=(await service.listSessions()).find(s=>s.id===session.id)!;
  assert(live.updatedAt>session.createdAt);
  await service.close();
  const reopened=new PrimeService(options);
  try { assert.equal((await reopened.listSessions()).find(s=>s.id===session.id)?.updatedAt,live.updatedAt); }
  finally{await reopened.close();}
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});

test('a failed CLI version check is retried on reconnect, without a restart', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-recheck-'));const cli=join(dir,'prime-agent');
 const daemon=await fakeDaemon(()=>({sessions:[]}));
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:daemon.socketPath});
 try {
  assert.equal((await service.status()).canCreateOwned,false);
  await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
  assert.equal((await service.status()).canCreateOwned,false); // Background polls reuse a recent failure.
  await service.connect();
  assert.equal((await service.status()).canCreateOwned,true);
 }finally{await service.close();await daemon.close();await rm(dir,{recursive:true,force:true});}
});

async function ownedFixture(run:(service:PrimeService,dir:string)=>Promise<void>) {
 const dir=await mkdtemp(join(tmpdir(),'owned-fixture-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent')});
 try { await run(service,dir); } finally{await service.close();await rm(dir,{recursive:true,force:true});}
}

test('owned creation rejects slash or blank prompts and non-directory workspaces before launching', async () => {
 await ownedFixture(async (service,dir)=>{
  const file=join(dir,'file.txt');await writeFile(file,'');
  for(const prompt of ['   ','/new','  /resume x']) await assert.rejects(service.createSession({cwd:dir,prompt,allowFileChanges:true}),/plain-language prompt/,prompt);
  for(const cwd of ['relative/dir',file]) await assert.rejects(service.createSession({cwd,prompt:'Hello',allowFileChanges:true}),/absolute workspace/,cwd);
  await assert.rejects(service.createSession({cwd:dir,prompt:'Hello',allowFileChanges:'yes' as any}),/Confirm/);
  assert.deepEqual(await service.listSessions(),[]);
  assert.equal(await service.hasOpenOwnedSessions(),false);
 });
});

test('model changes need provider/model before any session lookup; renames trim and cap titles', async () => {
 await ownedFixture(async (service,dir)=>{
  for(const model of ['model','/model','provider/']) await assert.rejects(service.setSessionModel('missing',model),/provider\/model/,model);
  await assert.rejects(service.setSessionModel('missing','provider/model'),/Read-only compatibility/);
  await assert.rejects(service.renameSession('missing','title'),/Read-only compatibility/);
  const session=await service.createSession({cwd:dir,prompt:'Rename me',allowFileChanges:true});
  await service.renameSession(session.id,'  Renamed  ');
  assert.equal((await service.listSessions())[0].title,'Renamed');
  await service.renameSession(session.id,' '+'y'.repeat(250));
  assert.equal((await service.listSessions())[0].title,'y'.repeat(200));
 });
});

test('streaming events mark an owned session running and show the partial reply until the run ends', async () => {
 await ownedFixture(async (service,dir)=>{
  const session=await service.createSession({cwd:dir,prompt:'Start',allowFileChanges:true});
  const status=async()=>(await service.listSessions())[0].status;
  await service.getMessages(session.id);
  assert.equal(await status(),'idle');
  await service.sendMessage(session.id,'STREAM_PARTIAL');
  assert.equal(await status(),'running');
  assert.deepEqual((await service.getMessages(session.id)).map(m=>[m.role,m.content]),[['user','Start'],['user','STREAM_PARTIAL'],['assistant','partial reply']]);
  await service.sendMessage(session.id,'FINISH_STREAM');
  assert.equal(await status(),'idle');
  assert.ok(!(await service.getMessages(session.id)).some(m=>m.content==='partial reply'));
 });
});

test('the agent-reported follow-up queue count is surfaced for owned sessions only when reported', async () => {
 await ownedFixture(async (service,dir)=>{
  const session=await service.createSession({cwd:dir,prompt:'Start',allowFileChanges:true});
  await service.getMessages(session.id);
  assert.equal((await service.listSessions())[0].queuedCount,0);
  await service.sendMessage(session.id,'QUEUE_ONE');
  await service.sendMessage(session.id,'QUEUE_ONE');
  await service.getMessages(session.id);
  assert.equal((await service.listSessions())[0].queuedCount,2);
  await service.sendMessage(session.id,'DRAIN_QUEUE');
  await service.getMessages(session.id);
  assert.equal((await service.listSessions())[0].queuedCount,0);
 });
});

test('desktop-owned usage and compaction go through the owned pipe only', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-usage-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const daemon=await fakeDaemon(command=>{assert.equal(command.type,'list');return {sessions:[{sessionId:'shared',activeSessionId:'mutable',cwd:'/shared'}]};});
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:daemon.socketPath});
 try {
  const session=await service.createSession({cwd:dir,prompt:'hello',allowFileChanges:true});
  const usage=await service.getSessionUsage(session.id);
  assert.equal(usage.tokens.total,15);assert.equal(usage.context?.percent,1.5);
  assert.deepEqual(await service.compactSession(session.id,'Keep decisions'),{tokensBefore:15});
  assert.equal((await service.getSessionUsage(session.id)).context?.percent,null);
  await assert.rejects(service.getSessionUsage('shared'),/Read-only compatibility/);
  await assert.rejects(service.compactSession('shared'),/Read-only compatibility/);
  await service.closeOwnedSession(session.id);
  await assert.rejects(service.compactSession(session.id),/closed/);
  assert(daemon.commands.every(command=>command.type==='list'));
 }finally{await service.close();await daemon.close();await rm(dir,{recursive:true,force:true});}
});
