let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer += chunk; let newline; while ((newline=buffer.indexOf('\n'))>=0) { const line=buffer.slice(0,newline); buffer=buffer.slice(newline+1); handle(line); } });
function handle(line) {
 const command = JSON.parse(line);
 if (command.type === 'never') return;
 if (command.type === 'crash') { process.exit(2); }
 if (command.type === 'malformed') { process.stdout.write('null\n'); return; }
 if (command.type === 'rejected') { process.stdout.write(JSON.stringify({type:'response',id:command.id,command:command.type,success:false,error:'Rejected by fixture'})+'\n');return; }
 if (command.type === 'prompt') process.stdout.write(JSON.stringify({ type:'agent_start' })+'\n');
 const result = { type: 'response', id: command.id, command: command.type, success: true, data: command.type === 'get_state' ? { sessionId: 'fixture', isStreaming: false } : { value: command.value } };
 process.stdout.write(JSON.stringify(result)+'\n');
}
process.stdin.on('end', () => process.exit(0));
