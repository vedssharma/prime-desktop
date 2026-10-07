import { test, expect, type Page } from './fixtures';
async function open(page: Page) {
  await page.addInitScript(()=>{
    const now=new Date().toISOString();
    const sessions:any[]=[{id:'closed',title:'Saved desktop',cwd:'/tmp',model:'fixture/vision',status:'idle',createdAt:now,updatedAt:now,ownership:'desktop',writable:false,lifecycle:'closed'}, {id:'shared',title:'Shared CLI',cwd:'/tmp',model:'',status:'idle',createdAt:now,updatedAt:now,ownership:'shared',writable:false}];
    const state=(window as any).__history={calls:[] as any[], reject:false, delay:false, settle:null as any};
    const operation=(mode:string,id:string,consent:boolean,entryId?:string)=>{
      state.calls.push(entryId ? [mode,id,consent,entryId] : [mode,id,consent]);
      return new Promise((resolve,reject)=>{
        const settle=()=>{state.settle=null;if(state.reject){reject(Error('Session lease is held by another owner'));return;}
          const session={...sessions[0],id:mode==='fork'?'fork':'closed',title:mode==='fork'?'Fork of Saved desktop':'Saved desktop',lifecycle:'open',writable:true};
          if(mode==='fork')sessions.push(session);else sessions[0]=session;
          resolve(session);
        };
        state.settle=settle;if(!state.delay)settle();
      });
    };
    (window as any).prime={
      status:async()=>({connected:true,canCreateOwned:true,readOnly:true,home:'/tmp'}),listSessions:async()=>sessions,listModels:async()=>[],getMessages:async()=>[{id:'m',role:'user',content:'Saved history'}],
      resumeOwnedSession:(id:string,consent:boolean)=>operation('resume',id,consent),forkOwnedSession:(id:string,consent:boolean,entryId?:string)=>operation('fork',id,consent,entryId),
      sendMessage:async()=>{state.calls.push(['send']);},setSessionModel:async()=>{},openDirectory:async()=>{},
    };
  });
  await page.goto('/');await page.locator('.session-item').filter({hasText:'Saved desktop'}).click();
}
async function action(page:Page,name:string) {await page.getByRole('button',{name:'Session actions',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}

test('resume requires renewed consent and reopens history without submitting a prompt', async ({page})=>{
  await open(page);await action(page,'Resume saved session');
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Resume session',exact:true})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:/I trust this workspace/}).check();
  await dialog.getByRole('button',{name:'Resume session',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).__history.calls)).toEqual([['resume','closed',true]]);
  await expect(page.locator('.message.user')).toContainText('Saved history');
  await page.getByRole('textbox',{name:'Message Prime'}).fill('Continue');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
});

test('fork selects a separate conversation and leaves its original history closed', async ({page})=>{
  await open(page);await action(page,'Fork saved session');
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'Create fork'})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:/I trust this workspace/}).check();
  await dialog.getByRole('button',{name:'Create fork'}).click();
  await expect(page.locator('.session-item.selected')).toContainText('Fork of Saved desktop');
  expect(await page.evaluate(()=>(window as any).__history.calls)).toEqual([['fork','closed',true]]);
  await page.locator('.session-item').filter({hasText:'Saved desktop'}).filter({hasNotText:'Fork of'}).click();
  await page.getByRole('textbox',{name:'Message Prime'}).fill('No');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
});

test('lease rejection stays visible and pending resume cannot be dismissed or dispatched twice', async ({page})=>{
  await open(page);await page.evaluate(()=>{Object.assign((window as any).__history,{reject:true,delay:true});});
  await action(page,'Resume saved session');const dialog=page.getByRole('dialog');
  await dialog.getByRole('checkbox',{name:/I trust this workspace/}).check();
  await dialog.getByRole('button',{name:'Resume session',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Resume session',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await page.evaluate(()=>(window as any).__history.settle());
  await expect(dialog.getByRole('alert')).toContainText('Session lease is held');
  expect(await page.evaluate(()=>(window as any).__history.calls)).toHaveLength(1);
});

test('shared CLI history has no fork or resume action', async ({page})=>{
  await open(page);await page.locator('.session-item').filter({hasText:'Shared CLI'}).click();
  await page.getByRole('button',{name:'Session actions',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume saved session',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Fork saved session',exact:true})).toHaveCount(0);
});

test('select an earlier message before giving fork consent', async ({page})=>{
 await open(page);await action(page,'Fork saved session');const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Fork through message').selectOption('m');
 await dialog.getByRole('checkbox',{name:/I trust this workspace/}).check();
 await dialog.getByRole('button',{name:'Create fork'}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).__history.calls)).toEqual([['fork','closed',true,'m']]);
});
