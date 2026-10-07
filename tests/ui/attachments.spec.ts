import { test, expect, type Page } from './fixtures';
const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image = {type:'image',mimeType:'image/png',data};
const file = (name = 'example.png') => ({name,mimeType:'image/png',buffer:Buffer.from(data,'base64')});
const picker = (page: Page) => page.getByLabel('Choose image attachments');
const send = (page: Page) => page.getByRole('button',{name:'Send message',exact:true});
const composer = (page: Page) => page.getByRole('textbox',{name:'Message Prime',exact:true});
async function open(page: Page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const sessions: any[] = ['Alpha','Beta','Shared','Text only'].map((title,index) => ({id:String(index),title,cwd:'/tmp',model:'fixture/vision',status:'idle',createdAt:now,updatedAt:now,ownership:index===2?'shared':'desktop',writable:index!==2,supportsImages:index!==3}));
    const messages: Record<string, any[]> = {};
    const controls = (window as any).__images = {calls:[] as any[],settle:null as any, reject:false, delay:false, sessions};
    (window as any).prime = {
      status:async()=>({connected:true,readOnly:true,canCreateOwned:true,home:'/tmp'}),
      listSessions:async()=>sessions,listModels:async()=>[{id:'fixture/vision',name:'Vision'}],
      getMessages:async(id:string)=>[...(messages[id]??[])], // IPC returns a fresh copy
      createSession:async(input:any)=>{controls.calls.push(['create',input]);const s={...sessions[0],id:'created',title:'Created'};sessions.push(s);messages.created=[{id:'new',role:'user',content:input.prompt,images:input.images}];return s;},
      sendMessage:(id:string,text:string,images:any[])=>{
        controls.calls.push(['send',id,text,images]);
        return new Promise<void>((resolve,reject)=>{
          const settle=()=>{controls.settle=null;if(controls.reject){reject(Error('Rejected attachment'));return;}messages[id]=[{id:'sent',role:'user',content:text,images}];resolve();};
          controls.settle=settle;if(!controls.delay)settle();
        });
      },
      setSessionModel:async()=>{},chooseDirectory:async()=>'/tmp',openDirectory:async()=>{},
    };
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Attach images'})).toBeEnabled();
}
const select = (page: Page, name: string) => page.locator('.session-item').filter({hasText:name}).click();

test('image-only new sessions require consent, send clean payloads and render image transcripts', async ({page}) => {
  await open(page);
  await picker(page).setInputFiles(file());
  await expect(page.getByRole('button',{name:'Remove example.png'})).toBeVisible();
  await expect(send(page)).toBeDisabled();
  await page.getByRole('checkbox',{name:/I trust this workspace/}).check();
  await send(page).click();
  await expect(page.locator('.message-images img')).toHaveAttribute('src',`data:image/png;base64,${data}`);
  await expect(page.getByRole('button',{name:'Remove example.png'})).toHaveCount(0);
  const calls=await page.evaluate(()=>(window as any).__images.calls);
  expect(calls[0][1].images).toEqual([image]);
  expect(calls[0][1].prompt).toBe('');
  expect(calls[0][1].allowFileChanges).toBe(true);
});

test('attachments belong to each draft and reload discards unsent images', async ({page}) => {
  await open(page);
  await picker(page).setInputFiles(file('new.png'));
  await expect(page.getByRole('button',{name:'Remove new.png'})).toBeVisible();
  await select(page,'Alpha');
  await picker(page).setInputFiles(file('alpha.png'));
  await expect(page.getByRole('button',{name:'Remove alpha.png'})).toBeVisible();
  await select(page,'Beta');
  await expect(page.locator('.draft-image')).toHaveCount(0);
  await select(page,'Alpha');
  await expect(page.getByRole('button',{name:'Remove alpha.png'})).toBeVisible();
  await page.getByRole('button',{name:/New session/}).click();
  await expect(page.getByRole('button',{name:'Remove new.png'})).toBeVisible();
  const stored=await page.evaluate(()=>Object.values(localStorage).join(''));
  expect(stored).not.toContain(data);
  await page.reload();
  await expect(page.locator('.draft-image')).toHaveCount(0);
});

test('rejection keeps images, while a changed draft survives late admission', async ({page}) => {
  await open(page);await select(page,'Alpha');
  await page.evaluate(()=>{(window as any).__images.reject=true;});
  await picker(page).setInputFiles(file());
  await expect(page.getByRole('button',{name:'Remove example.png'})).toBeVisible();
  await send(page).click();
  await expect(page.getByText('Rejected attachment',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Remove example.png'})).toBeVisible();
  await page.evaluate(()=>{Object.assign((window as any).__images,{reject:false,delay:true});});
  await send(page).click();
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).__images.settle)).toBe('function');
  await page.getByRole('button',{name:'Remove example.png'}).click();
  await composer(page).fill('Replacement draft');
  await page.evaluate(()=>(window as any).__images.settle());
  await expect(composer(page)).toHaveValue('Replacement draft');
  await expect(page.locator('.draft-image')).toHaveCount(0);
  await expect(page.locator('.message-images img')).toHaveCount(1);
});

test('late admission clears only the originating draft and preserves another session attachment', async ({page}) => {
  await open(page);await select(page,'Alpha');
  await picker(page).setInputFiles(file('alpha.png'));
  await expect(page.getByRole('button',{name:'Remove alpha.png'})).toBeVisible();
  await page.evaluate(()=>{(window as any).__images.delay=true;});
  await send(page).click();
  await select(page,'Beta');
  await picker(page).setInputFiles(file('beta.png'));
  await expect(page.getByRole('button',{name:'Remove beta.png'})).toBeVisible();
  await page.evaluate(()=>(window as any).__images.settle());
  await expect(page.getByRole('button',{name:'Remove beta.png'})).toBeVisible();
  await select(page,'Alpha');
  await expect(page.locator('.draft-image')).toHaveCount(0);
});

test('unsupported, corrupt, oversized and excessive files do not replace valid attachments', async ({page}) => {
  await open(page);await select(page,'Alpha');
  await picker(page).setInputFiles(file());
  await expect(page.getByRole('button',{name:'Remove example.png'})).toBeVisible();
  for (const bad of [
    {name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},
    {name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')},
    {name:'header.png',mimeType:'image/png',buffer:Buffer.from(data,'base64').subarray(0,8)},
    {name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(384*1024+1)},
  ]) {
    await picker(page).setInputFiles(bad);
    await expect(page.locator('.attachment-error')).toBeVisible();
    await expect(page.locator('.draft-image')).toHaveCount(1);
  }
  await picker(page).setInputFiles(Array.from({length:4},(_,index)=>file(`${index}.png`)));
  await expect(page.locator('.attachment-error')).toContainText('up to 4');
  await expect(page.locator('.draft-image')).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).__images.calls)).toEqual([]);
});

test('shared and text-only sessions cannot pick images', async ({page}) => {
  await open(page);
  await select(page,'Shared');await expect(page.getByRole('button',{name:'Attach images'})).toBeDisabled();
  await select(page,'Text only');await expect(page.getByRole('button',{name:'Attach images'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Attach images'})).toHaveAttribute('title',/image-capable model/);
});


test('running sessions queue image follow-ups and narrow layouts retain visible controls', async ({page}) => {
  await open(page);
  await page.evaluate(()=>{(window as any).__images.sessions[0].status='running';});
  await select(page,'Alpha');
  await picker(page).setInputFiles(file());
  await expect(page.getByRole('button',{name:'Remove example.png'})).toBeVisible();
  await page.setViewportSize({width:760,height:560});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole('button',{name:'Queue follow-up',exact:true}).click();
  await expect(page.getByText(/Follow-up queued. Prime/)).toBeVisible();
  expect((await page.evaluate(()=>(window as any).__images.calls))[0]).toEqual(['send','0','',[image]]);
});

test('a picker completing after a session switch updates only its originating draft', async ({page}) => {
  await open(page);await select(page,'Alpha');
  await page.evaluate(()=>{
    const decode=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=function(){
      return new Promise<void>((resolve,reject)=>{(window as any).__finishImage=()=>{delete(window as any).__finishImage;decode.call(this).then(resolve,reject);};});
    };
  });
  await picker(page).setInputFiles(file('late.png'));
  await expect.poll(()=>page.evaluate(()=>typeof(window as any).__finishImage)).toBe('function');
  await select(page,'Beta');
  await page.evaluate(()=>(window as any).__finishImage());
  await expect(page.locator('.draft-image')).toHaveCount(0);
  await select(page,'Alpha');
  await expect(page.getByRole('button',{name:'Remove late.png'})).toBeVisible();
});
