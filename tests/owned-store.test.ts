import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, writeFile } from 'node:fs/promises';
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

const record=(store:OwnedStore,overrides:Record<string,unknown>={})=>({id:`desktop-${randomUUID()}`,sessionId:'persistent',sessionFile:join(store.transcripts,'p.jsonl'),cwd:store.directory,title:'t',model:'m',createdAt:'now',updatedAt:'now',...overrides});

test('invalid metadata and transcripts outside the store are rejected before any write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owned-store-'));const store=new OwnedStore(dir);
 try{await store.initialize();
  for(const overrides of [{id:'desktop-short'},{id:'other-'+randomUUID()},{id:`desktop-${randomUUID()}/../x`},{title:undefined},{model:5},{sessionId:''},{cwd:'relative/path'},
   {sessionFile:join(store.transcripts,'..','escape.jsonl')},{sessionFile:join(store.directory,'sibling.jsonl')},{sessionFile:'/elsewhere/p.jsonl'},{sessionFile:'../p.jsonl'}]){
   await assert.rejects(store.save(record(store,overrides) as any),/Invalid desktop/,JSON.stringify(overrides));
  }
  assert.deepEqual((await readdir(store.directory)).sort(),['transcripts']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('listing skips corrupt, renamed, temporary and oversized records without hiding valid ones',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owned-store-'));const store=new OwnedStore(dir);
 try{await store.initialize();
  const valid=record(store);await store.save(valid);
  const put=(name:string,value:string)=>writeFile(join(store.directory,name),value);
  await put(`desktop-${randomUUID()}.json`,'{corrupt');
  await put(`desktop-${randomUUID()}.json`,JSON.stringify(record(store))); // id differs from its filename
  await put(`desktop-${randomUUID()}.json`,JSON.stringify(record(store,{sessionFile:'/elsewhere/p.jsonl'})));
  const big=record(store);await put(`${big.id}.json`,JSON.stringify({...big,title:'x'.repeat(33*1024)}));
  const temp=record(store);await put(`${temp.id}.json.${randomUUID()}.tmp`,JSON.stringify(temp));
  await put('notes.json',JSON.stringify(record(store)));
  assert.deepEqual(await store.list(),[valid]);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('store directories and metadata files are private to the user',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'owned-store-'));const store=new OwnedStore(join(dir,'desktop'));
 try{await store.initialize();const value=record(store);await store.save(value);
  assert.equal((await stat(store.directory)).mode&0o777,0o700);
  assert.equal((await stat(store.transcripts)).mode&0o777,0o700);
  assert.equal((await stat(join(store.directory,value.id+'.json'))).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
