#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('0.9.6'); process.exit(0); }
if (process.argv.includes('model')) { console.log('fixture fixture-model 128K 8K'); process.exit(0); }
const value = flag => process.argv[process.argv.indexOf(flag) + 1];
const cwd = value('--cwd'), dir = value('--session-dir');
mkdirSync(dir, { recursive: true });
const source = process.argv.includes('--resume') ? value('--resume') : process.argv.includes('--fork') ? value('--fork') : undefined;
const records = source ? readFileSync(source,'utf8').trim().split('\n').map(line=>JSON.parse(line)) : [];
const id = process.argv.includes('--resume') ? records[0].id : randomUUID();
const file = process.argv.includes('--resume') ? source : join(dir, id + '.jsonl');
if (!process.argv.includes('--resume')) writeFileSync(file, JSON.stringify({ type: 'session', id, cwd, ...(source?{parentSession:source}:{}) }) + '\n' + records.slice(1).map(record=>JSON.stringify(record)+'\n').join(''));
let leaf = records.at(-1)?.id ?? null;
const selected = process.argv.includes('--model') ? value('--model').split('/').slice(1).join('/') : records.findLast(record=>record.type==='model_change')?.modelId ?? 'fixture-model';
const messages = records.filter(record=>record.type==='message').map(record=>record.message); let failState = false; let queued = 0; let compacted = false; let model = { provider:'fixture', id:selected, name:'Fixture model', input:selected==='text-only'?['text']:['text','image'] };
function event(value) { process.stdout.write(JSON.stringify(value)+'\n'); }
function reply(command, success, data, error) { process.stdout.write(JSON.stringify({ type:'response',command:command.type,id:command.id,success,data,error })+'\n'); }
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);handle(JSON.parse(line));}});
function handle(command) {
 if(command.type==='get_state' && failState) return reply(command,false,undefined,'Read failed after admission');
 if(command.type==='get_state') return reply(command,true,{sessionId:id,sessionFile:file,isStreaming:false,isCompacting:false,model,sessionActions:{queuedCount:queued}});
 if(command.type==='get_messages')return reply(command,true,{messages});
 if(command.type==='prompt') {
  if(command.message==='ACCEPT_THEN_FAIL_READ') failState=true;
  const msg={role:'user',content: command.images?.length ? [{type:'text',text:command.message}, ...command.images] : command.message,timestamp:Date.now()};messages.push(msg);
  leaf=randomUUID();appendFileSync(file,JSON.stringify({type:'message',id:leaf,parentId:null,message:msg})+'\n');
  // This explicit fixture instruction is not a model call or arbitrary code execution.
  if(command.message==='WRITE_FIXTURE_FILE') writeFileSync(join(cwd,'owned-proof.txt'),'written by isolated RPC fixture\n');
  // Streaming markers emit agent events the way a real run would, without a model call.
  if(command.message==='STREAM_PARTIAL'){event({type:'agent_start'});event({type:'message_update',message:{role:'assistant',content:'partial reply',timestamp:1}});}
  if(command.message==='QUEUE_ONE')queued++;
  if(command.message==='DRAIN_QUEUE')queued=0;
  if(command.message==='FINISH_STREAM'){event({type:'message_end'});event({type:'agent_end'});}
  return reply(command,true);
 }
 if(command.type==='set_model'){const parentId=leaf;leaf=randomUUID();appendFileSync(file,JSON.stringify({type:'model_change',id:leaf,parentId,provider:command.provider,modelId:command.modelId})+'\n');model={provider:command.provider,id:command.modelId,input:command.modelId==='text-only'?['text']:['text','image']};return reply(command,true,model);}
 if(command.type==='get_available_models')return reply(command,true,{models:[model]});
 if(command.type==='abort')return reply(command,true);
 if(command.type==='get_session_stats')return reply(command,true,{sessionId:id,userMessages:messages.length,assistantMessages:0,toolCalls:0,tokens:{input:10,output:5,cacheRead:0,cacheWrite:0,total:15},cost:0.001,contextUsage:{tokens:compacted?null:15,contextWindow:1000,percent:compacted?null:1.5}});
 if(command.type==='compact'){compacted=true;return reply(command,true,{summary:'s',firstKeptEntryId:'e',tokensBefore:15,customInstructions:command.customInstructions});}
 reply(command,false,undefined,'Unsupported fixture command');
}
process.stdin.on('end',()=>process.exit(0));
