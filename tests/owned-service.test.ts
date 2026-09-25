import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, copyFile, chmod, mkdir } from 'node:fs/promises';
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
