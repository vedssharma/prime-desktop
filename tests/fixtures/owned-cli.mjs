#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('0.9.6'); process.exit(0); }
if (process.argv.includes('model')) { console.log('fixture fixture-model 128K 8K'); process.exit(0); }
const value = flag => process.argv[process.argv.indexOf(flag) + 1];
const id = randomUUID(), cwd = value('--cwd'), dir = value('--session-dir');
mkdirSync(dir, { recursive: true });
const file = join(dir, id + '.jsonl');
writeFileSync(file, JSON.stringify({ type: 'session', id, cwd }) + '\n');
const messages = []; let failState = false; let model = { provider:'fixture', id:'fixture-model', name:'Fixture model' };
function reply(command, success, data, error) { process.stdout.write(JSON.stringify({ type:'response',command:command.type,id:command.id,success,data,error })+'\n'); }
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);handle(JSON.parse(line));}});
function handle(command) {
 if(command.type==='get_state' && failState) return reply(command,false,undefined,'Read failed after admission');
 if(command.type==='get_state') return reply(command,true,{sessionId:id,sessionFile:file,isStreaming:false,isCompacting:false,model});
 if(command.type==='get_messages')return reply(command,true,{messages});
 if(command.type==='prompt') {
  if(command.message==='ACCEPT_THEN_FAIL_READ') failState=true;
  const msg={role:'user',content:command.message,timestamp:Date.now()};messages.push(msg);
  appendFileSync(file,JSON.stringify({type:'message',id:randomUUID(),parentId:null,message:msg})+'\n');
  // This explicit fixture instruction is not a model call or arbitrary code execution.
  if(command.message==='WRITE_FIXTURE_FILE') writeFileSync(join(cwd,'owned-proof.txt'),'written by isolated RPC fixture\n');
  return reply(command,true);
 }
 if(command.type==='set_model'){model={provider:command.provider,id:command.modelId};return reply(command,true,model);}
 if(command.type==='get_available_models')return reply(command,true,{models:[model]});
 if(command.type==='abort')return reply(command,true);
 reply(command,false,undefined,'Unsupported fixture command');
}
process.stdin.on('end',()=>process.exit(0));
