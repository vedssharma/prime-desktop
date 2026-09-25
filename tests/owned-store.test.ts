import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OwnedStore } from '../electron/owned-store.js';
test('metadata writes serialize same-session updates and preserve final snapshot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owned-store-'));const store=new OwnedStore(dir);
 try{await store.initialize();const base={id:`desktop-${randomUUID()}`,sessionId:'persistent',sessionFile:join(store.transcripts,'p.jsonl'),cwd:store.directory,title:'initial',model:'m',createdAt:'now',updatedAt:'now'};
 await Promise.all(Array.from({length:8},(_,i)=>store.save({...base,title:`title-${i}`})));
 assert.equal((await store.list())[0].title,'title-7');
 }finally{await rm(dir,{recursive:true,force:true});}
});
