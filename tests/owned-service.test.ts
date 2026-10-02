import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, copyFile, chmod, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrimeService, type SessionEvent } from '../electron/prime.js';
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
  assert.equal((await service.getMessages(session.id)).length,2); // fixture retains a coherent conversation branch
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
  for(const prompt of ['   ','/new','  /resume x']) await assert.rejects(service.createSession({cwd:dir,prompt,allowFileChanges:true}),/message or attach|Slash commands/,prompt);
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


test('images travel through the owned subprocess and saved history, with model and shared-session guards', async () => {
 await ownedFixture(async (service, dir) => {
  const image = {type:'image' as const,mimeType:'image/png' as const,data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
  const session = await service.createSession({cwd:dir,prompt:'',images:[image],allowFileChanges:true});
  assert.equal(session.supportsImages,true);
  assert.equal(session.title,'Image conversation');
  assert.deepEqual((await service.getMessages(session.id))[0].images,[image]);
  await service.sendMessage(session.id,'Follow-up',[image]);
  assert.deepEqual((await service.getMessages(session.id))[1].images,[image]);
  await service.setSessionModel(session.id,'fixture/text-only');
  await assert.rejects(service.sendMessage(session.id,'No',[image]),/image support/);
  await assert.rejects(service.sendMessage('shared','No',[image]),/Read-only compatibility/);
  await service.closeOwnedSession(session.id);
  assert.deepEqual((await service.getMessages(session.id))[0].images,[image]);
  await assert.rejects(service.createSession({cwd:dir,prompt:'No',images:[image],model:'fixture/text-only',allowFileChanges:true}),/image support/);
  assert.equal(await service.hasOpenOwnedSessions(),false);
 });
});

test('explicit resume keeps identity and fork creates independent saved history without prompting', async () => {
 await ownedFixture(async (service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'Original history',allowFileChanges:true});
  await assert.rejects(service.resumeOwnedSession(original.id,true),/Close/);
  await assert.rejects(service.forkOwnedSession(original.id,true),/Close/);
  await service.closeOwnedSession(original.id);
  await assert.rejects(service.resumeOwnedSession(original.id,false),/trust/);
  await assert.rejects(service.forkOwnedSession('shared',true),/Read-only/);
  const fork=await service.forkOwnedSession(original.id,true);
  assert.notEqual(fork.id,original.id);assert.equal(fork.writable,true);
  assert.equal(fork.title,'Fork of Original history');
  assert.equal((await service.getMessages(fork.id))[0].content,'Original history');
  assert.equal((await service.listSessions()).find(session=>session.id===original.id)?.writable,false);
  await service.sendMessage(fork.id,'Only in the fork');
  assert.equal((await service.getMessages(original.id))[0].content,'Original history');
  const resumed=await service.resumeOwnedSession(original.id,true);
  assert.equal(resumed.id,original.id);assert.equal(resumed.writable,true);
  assert.equal((await service.getMessages(original.id))[0].content,'Original history');
  await service.sendMessage(original.id,'Resumed follow-up');
  assert.equal((await service.getMessages(fork.id)).at(-1)?.content,'Only in the fork');
 });
});

test('saved-history startup rejects tampering, symlinks and simultaneous opens without takeover', async () => {
 await ownedFixture(async (service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'Original',allowFileChanges:true});
  await service.closeOwnedSession(original.id);
  const metadataFile=join(dir,'desktop',original.id+'.json');
  const metadata=JSON.parse(await readFile(metadataFile,'utf8'));
  const bytes=await readFile(metadata.sessionFile,'utf8');
  await writeFile(metadata.sessionFile,bytes.replace(metadata.sessionId,'another-id'));
  await assert.rejects(service.resumeOwnedSession(original.id,true),/identity mismatch/);
  await writeFile(metadata.sessionFile,bytes);
  const pending=service.resumeOwnedSession(original.id,true);
  await assert.rejects(service.resumeOwnedSession(original.id,true),/already opening/);
  await pending;await service.closeOwnedSession(original.id);
  const {symlink,unlink}=await import('node:fs/promises');
  const outside=join(dir,'outside.jsonl');await writeFile(outside,bytes);
  await unlink(metadata.sessionFile);await symlink(outside,metadata.sessionFile);
  await assert.rejects(service.forkOwnedSession(original.id,true),/regular file/);
  assert.equal(await service.hasOpenOwnedSessions(),false);
 });
});

test('saved history must match its original workspace and contain a single valid header', async () => {
 await ownedFixture(async (service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'Original',allowFileChanges:true});
  await service.closeOwnedSession(original.id);
  const metadata=JSON.parse(await readFile(join(dir,'desktop',original.id+'.json'),'utf8'));
  const bytes=await readFile(metadata.sessionFile,'utf8');
  const other=join(dir,'other');await mkdir(other);
  const header=JSON.parse(bytes.split('\n')[0]);
  await writeFile(metadata.sessionFile,JSON.stringify({...header,cwd:other})+'\n'+bytes.split('\n').slice(1).join('\n'));
  await assert.rejects(service.resumeOwnedSession(original.id,true),/workspace mismatch/);
  await writeFile(metadata.sessionFile,bytes+JSON.stringify(header)+'\n');
  await assert.rejects(service.forkOwnedSession(original.id,true),/Multiple session headers/);
  await writeFile(metadata.sessionFile,bytes+'broken\n');
  await assert.rejects(service.resumeOwnedSession(original.id,true),/invalid JSON/);
  assert.equal(await service.hasOpenOwnedSessions(),false);
 });
});

test('shutdown waits for saved-history startup and leaves no owned process running', async () => {
 await ownedFixture(async (service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'Original',allowFileChanges:true});
  await service.closeOwnedSession(original.id);
  const opening=service.resumeOwnedSession(original.id,true);
  const rejection=assert.rejects(opening,/closing|closed/);
  await service.close();await rejection;
  assert.equal(await service.hasOpenOwnedSessions(),false);
 });
});

test('fork verifies the copied history when the source changes during CLI startup', async () => {
 await ownedFixture(async (service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'Original',allowFileChanges:true});
  await service.closeOwnedSession(original.id);
  const cli=join(dir,'prime-agent');
  const code=await readFile(cli,'utf8');
  await writeFile(cli,code.replace('const records = source ?', "if (process.argv.includes('--fork')) writeFileSync(source,readFileSync(source,'utf8').replace('Original','Replaced'));\nconst records = source ?"));
  await assert.rejects(service.forkOwnedSession(original.id,true),/Fork history mismatch/);
  assert.equal(await service.hasOpenOwnedSessions(),false);
  assert.equal((await service.listSessions()).length,1);
 });
});

test('earlier-message fork uses a private snapshot and preserves the complete source', async () => {
 await ownedFixture(async(service,dir)=>{
  const original=await service.createSession({cwd:dir,prompt:'First message',allowFileChanges:true});
  await service.sendMessage(original.id,'Later message');
  await service.closeOwnedSession(original.id);
  const messages=await service.getMessages(original.id);
  const fork=await service.forkOwnedSession(original.id,true,messages[0].id);
  assert.deepEqual((await service.getMessages(fork.id)).map(message=>message.content),['First message']);
  assert.equal((await service.getMessages(original.id)).length,2);
  await assert.rejects(service.forkOwnedSession(original.id,true,'absent'),/Select/);
  await service.sendMessage(fork.id,'Independent continuation');
  assert.equal((await service.getMessages(original.id)).length,2);
 });
});

test('owned sessions push throttled stream, message and activity events with IDs that match later reads', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-events-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const events:SessionEvent[]=[];
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent'),onEvent:event=>events.push(event)});
 try {
  const session=await service.createSession({cwd:dir,prompt:'Start',allowFileChanges:true});
  await service.sendMessage(session.id,'STREAM_PARTIAL');
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.deepEqual(events.map(event=>event.type),['activity','stream']);
  const stream=events[1];
  assert(stream.type==='stream');
  assert.equal(stream.sessionId,session.id);
  assert.deepEqual(stream.messages.map(m=>[m.role,m.content]),[['assistant','partial reply']]);
  // The streamed reply must keep its ID when it appears in a full read, so the UI patches it in place.
  const read=await service.getMessages(session.id);
  assert.equal(read.at(-1)?.id,stream.streamId);
  assert.equal(stream.messages[0].id,stream.streamId);
  await service.sendMessage(session.id,'FINISH_STREAM');
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.deepEqual(events.slice(2).map(event=>event.type),['changed','activity']);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});

test('a listener that throws does not break the owned session', async () => {
 const dir=await mkdtemp(join(tmpdir(),'owned-events-throw-'));const cli=join(dir,'prime-agent');
 await copyFile(resolve('tests/fixtures/owned-cli.mjs'),cli);await chmod(cli,0o700);
 const service=new PrimeService({executable:cli,desktopDir:join(dir,'desktop'),socketPath:join(dir,'absent'),onEvent:()=>{throw new Error('renderer gone');}});
 try {
  const session=await service.createSession({cwd:dir,prompt:'Start',allowFileChanges:true});
  await service.sendMessage(session.id,'STREAM_PARTIAL');
  await new Promise(resolve=>setTimeout(resolve,120));
  await service.sendMessage(session.id,'FINISH_STREAM');
  assert.equal((await service.listSessions())[0].writable,true);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});
