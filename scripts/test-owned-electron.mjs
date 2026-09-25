import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, copyFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'dock-owned-e2e-'));
const cli=path.join(dir,'prime-agent');await copyFile('tests/fixtures/owned-cli.mjs',cli);await chmod(cli,0o700);
const executable=process.env.PRIME_DESKTOP_EXECUTABLE ? path.resolve(process.env.PRIME_DESKTOP_EXECUTABLE) : undefined;
const app=await electron.launch({...(executable ? {executablePath:executable,args:[`--user-data-dir=${path.join(dir,'profile')}`]} : {args:['.',`--user-data-dir=${path.join(dir,'profile')}`]}),env:{...process.env,PRIME_AGENT_BIN:cli,PRIME_DESKTOP_SOCKET:path.join(dir,'absent.sock'),PRIME_DESKTOP_DEV_URL:''}});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(10000);await page.waitForFunction(()=>!!window.prime);
 expect((await page.evaluate(()=>window.prime.status())).canCreateOwned).toBe(true);
 await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]});},dir);
 await page.locator('.folder-control').click();
 await page.getByRole('textbox',{name:'Message Prime',exact:true}).fill('WRITE_FIXTURE_FILE');
 await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:/I trust this workspace/}).check();
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.locator('.session-item').filter({hasText:'WRITE_FIXTURE_FILE'})).toBeVisible();
 await expect(page.locator('.message.user')).toContainText('WRITE_FIXTURE_FILE');
 expect(await readFile(path.join(dir,'owned-proof.txt'),'utf8')).toContain('isolated RPC fixture');
 const sessions=await page.evaluate(()=>window.prime.listSessions());const owned=sessions.find(s=>s.ownership==='desktop');expect(owned.writable).toBe(true);
 await expect(page.evaluate(()=>window.prime.sendMessage('unrelated-shared-session','no'))).rejects.toThrow(/Read-only compatibility/);
 await page.evaluate(id=>window.prime.closeOwnedSession(id),owned.id);
 await expect.poll(async()=> (await page.evaluate(()=>window.prime.listSessions())).find(s=>s.id===owned.id)?.writable).toBe(false);
 console.log('Owned Electron integration passed: consent, isolated fixture write, shared guard, close to saved history. No LLM request made.');
}catch(error){console.error(error);throw error;}finally{await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});}).catch(()=>{});try{const page=await app.firstWindow();await page.evaluate(async()=>{for(const session of await window.prime.listSessions())if(session.ownership==='desktop')await window.prime.closeOwnedSession(session.id);});}catch{}await app.close();await rm(dir,{recursive:true,force:true});}
