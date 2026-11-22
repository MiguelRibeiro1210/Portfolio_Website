import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.__errors=errors;
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Back to building.'})).toBeVisible();
  await page.getByRole('link',{name:'Projects',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Ideas. Unboxed./})).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

async function navigate(page,hash) {
  await page.evaluate(value=>{location.hash=value;},hash);
  await expect(page.locator('main')).toBeVisible();
}
async function saveProject(page,{title='A real project',type='open',permission='public'}={}) {
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill(title);
  await page.locator(`input[name=type][value=${type}]`).check();
  await page.getByLabel('Short description').fill('A project added through the local editor.');
  await page.getByLabel('Tech stack').fill('JavaScript, CSS');
  await page.getByLabel('Download permission').selectOption(permission);
  await page.getByLabel('Show in the collection').check();
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page).toHaveURL(/#\/studio\/[\w-]+$/);
  await expect(page.locator('.draft-chip.active')).toContainText(title);
  return page.url().split('/studio/')[1];
}
test('all pages render and remain inside the viewport', async ({page}, testInfo) => {
  for(const path of ['/','/project/placeholder','/about','/studio','/studio?section=profile','/studio?section=security','/signin','/register','/reset','/states','/does-not-exist']) {
    await navigate(page,path);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path).toBe(true);
    if(path==='/') {
      await expect(page.locator('.showroom-heading h1')).toHaveText('Ideas. Unboxed.');
      await expect(page.locator('.site-header')).toHaveCSS('background-color','rgb(121, 46, 48)');
      await expect(page.locator('body')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(page.locator('.project-card').first()).toHaveCSS('background-color','rgb(121, 46, 48)');
      const geometry=await page.locator('.project-visual .form').first().evaluate(el=>({bottom:el.getBoundingClientRect().bottom,textBottom:el.querySelector('.mock-type-row').getBoundingClientRect().bottom}));
      expect(geometry.textBottom).toBeLessThanOrEqual(geometry.bottom+1);
    }
    if (['/','/project/placeholder','/studio','/about','/signin','/states'].includes(path)) {
      await page.screenshot({path:testInfo.outputPath(`${path.replaceAll('/','-')||'home'}.png`), fullPage:true});
    }
    const viewport=page.viewportSize();
    await page.setViewportSize({width:320,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`320px: ${path}`).toBe(true);
    await page.setViewportSize(viewport);
  }
  await navigate(page,'/');
  await page.getByRole('button',{name:'Explore the collection'}).click();
  await expect(page.locator('#collection')).toBeInViewport();
});
test('create, filter, update, and delete a temporary project',async ({page})=>{
  const id=await saveProject(page);
  await navigate(page,'/');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.getByRole('button',{name:/Private/}).click();
  await expect(page.getByRole('heading',{name:'No private projects yet.'})).toBeVisible();
  await page.getByRole('button',{name:'Show all works'}).click();
  await page.locator('.project-card').click();
  await expect(page.locator('h1')).toHaveText('A real project');
  await page.getByRole('tab',{name:'Release notes'}).click();
  await expect(page.getByRole('tabpanel')).toContainText('Release notes will appear here.');
  await page.getByRole('tab',{name:'Tech specs'}).click();
  await expect(page.getByRole('tabpanel')).toContainText('JavaScript, CSS');
  await page.getByRole('link',{name:'Edit project'}).click();
  await page.getByLabel('Project title').fill('An updated project');
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByText('Project updated for this preview.').last()).toBeVisible();
  await navigate(page,'/');
  await navigate(page,`/studio/${id}`);
  await expect(page.getByLabel('Project title')).toHaveValue('An updated project');
  await page.getByRole('button',{name:'Delete project',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();
  await expect(page.getByLabel('Project title')).toHaveValue('An updated project');
  await page.getByRole('button',{name:'Delete project',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Delete project'}).click();
  await expect(page).toHaveURL(/#\/studio$/);
  await navigate(page,`/project/${id}`);
  await expect(page.getByRole('heading',{name:'This room is empty.'})).toBeVisible();
});
test('featured project controls cycle through saved projects',async ({page})=>{
  await saveProject(page,{title:'First project'});
  await saveProject(page,{title:'Second project',type:'private'});
  await navigate(page,'/');
  await expect(page.locator('.featured-copy h2')).toHaveText('First project');
  await page.getByRole('button',{name:'Next featured project'}).click();
  await expect(page.locator('.featured-copy h2')).toHaveText('Second project');
  await page.getByRole('button',{name:'Previous featured project'}).click();
  await expect(page.locator('.featured-copy h2')).toHaveText('First project');
});
test('fresh visits start at sign-in and explicit page links remain available',async ({page})=>{
  await page.goto('/');
  await expect(page).toHaveURL(/#\/signin$/);
  await expect(page.getByRole('heading',{name:'Back to building.'})).toBeVisible();
  await page.getByRole('link',{name:'Projects',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ideas. Unboxed.'})).toBeVisible();
  await page.goto('/#/about');
  await expect(page.getByRole('heading',{name:'Behind the projects.'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Behind the projects.'})).toBeVisible();
});
test('preview works without browser storage and resets records and files on refresh',async ({page})=>{
  await page.addInitScript(() => {
    for (const name of ['indexedDB','localStorage','sessionStorage']) {
      Object.defineProperty(window,name,{get(){throw new Error(`Unexpected browser storage access: ${name}`);}});
    }
  });
  await page.reload();
  await expect(page.getByRole('heading',{name:'Ideas. Unboxed.'})).toBeVisible();
  const id=await saveProject(page,{title:'Temporary project'});
  await page.locator('#build-input').setInputFiles({name:'preview.zip',mimeType:'application/zip',buffer:Buffer.from('preview-file')});
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByText('Project updated for this preview.').last()).toBeVisible();
  const fileId=await page.locator('[data-filename="preview.zip"]').getAttribute('data-download');
  await navigate(page,'/studio?section=profile');
  await page.getByLabel('Name',{exact:true}).fill('Temporary maker');
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByText('Profile updated for this preview.')).toBeVisible();
  await navigate(page,'/studio?section=security');
  await page.getByLabel('Default permission for future downloads').selectOption('none');
  await page.getByRole('button',{name:'Save preference'}).click();
  await expect(page.getByText('Download preference updated for this preview.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Default permission for future downloads')).toHaveValue('request');
  await navigate(page,'/studio?section=profile');
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('');
  await navigate(page,`/project/${id}`);
  await expect(page.getByRole('heading',{name:'This room is empty.'})).toBeVisible();
  expect(await page.evaluate(async id=>(await import('/js/api.js')).repository.file(id),fileId)).toBeUndefined();
});
test('wheel gestures advance one slide and release page scrolling at the end',async ({page})=>{
  await saveProject(page,{title:'First project'});
  await saveProject(page,{title:'Second project'});
  await saveProject(page,{title:'Third project'});
  await navigate(page,'/');
  await page.locator('.featured-preview').scrollIntoViewIfNeeded();
  await page.locator('.featured-preview').hover();
  const initialY=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,120);
  await expect(page.locator('.featured-copy h2')).toHaveText('Second project');
  await page.mouse.wheel(0,120);
  await expect(page.locator('.featured-copy h2')).toHaveText('Second project');
  expect(Math.abs(await page.evaluate(()=>scrollY)-initialY)).toBeLessThan(2);
  // A separate gesture after the momentum guard can select the next slide.
  await page.waitForTimeout(700);
  await page.mouse.wheel(0,120);
  await expect(page.locator('.featured-copy h2')).toHaveText('Third project');
  await page.waitForTimeout(700);
  const endY=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,350);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(endY);
});
test('horizontal touch swipes and keyboard arrows navigate featured projects',async ({page})=>{
  await saveProject(page,{title:'First project'});
  await saveProject(page,{title:'Second project'});
  await navigate(page,'/');
  await page.locator('.featured-preview').evaluate(el=>{
    const rect=el.getBoundingClientRect();
    const touch=new Touch({identifier:1,target:el,clientX:rect.left+150,clientY:rect.top+60});
    el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch],changedTouches:[touch]}));
    const end=new Touch({identifier:1,target:el,clientX:rect.left+60,clientY:rect.top+65});
    el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[end]}));
  });
  await expect(page.locator('.featured-copy h2')).toHaveText('Second project');
  await page.getByRole('region',{name:'Featured projects'}).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.featured-copy h2')).toHaveText('First project');
  await expect(page.getByRole('region',{name:'Featured projects'})).toBeFocused();
});
test('temporary media sorting, removal, and build downloads work',async ({page})=>{
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Media project');
  await page.getByLabel('Download permission').selectOption('public');
  await page.getByLabel('Show in the collection').check();
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=','base64');
  await page.locator('#media-input').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image}]);
  await page.locator('#build-input').setInputFiles({name:'release.zip',mimeType:'application/zip',buffer:Buffer.from('local-release')});
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page).toHaveURL(/#\/studio\/[\w-]+$/);const id=page.url().split('/studio/')[1];
  await page.getByRole('button',{name:'Move second.png earlier'}).click();
  await page.getByRole('button',{name:'Save changes'}).click();
  await navigate(page,'/');
  await navigate(page,`/studio/${id}`);
  await expect(page.locator('.file-list [data-file-row]').first()).toContainText('second.png');
  await navigate(page,`/project/${id}`);
  await expect(page.locator('.media-view img')).toBeVisible();
  await page.getByRole('button',{name:'View first.png'}).click();
  await expect(page.locator('.media-view img')).toHaveAttribute('alt','first.png');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'release.zip'}).click();
  expect((await download).suggestedFilename()).toBe('release.zip');
  await navigate(page,`/studio/${id}`);
  await page.getByRole('button',{name:'Remove second.png'}).click();
  await page.getByRole('button',{name:'Save changes'}).click();
  await navigate(page,'/');
  await navigate(page,`/studio/${id}`);
  await expect(page.locator('.file-list [data-file-row]')).toHaveCount(1);
});
test('profile placeholders become real content and CV downloads work',async ({page})=>{
  await navigate(page,'/about');
  await expect(page.getByText('Your name', {exact:true})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  await navigate(page,'/studio?section=profile');
  await page.getByLabel('Name',{exact:true}).fill('Test Maker');
  await page.getByLabel('Role',{exact:true}).fill('Developer');
  await page.getByLabel('About',{exact:true}).fill('An introduction written by the user.');
  await page.getByLabel('Skills',{exact:true}).fill('JavaScript, CSS');
  await page.getByLabel('Contact email').fill('maker@example.com');
  await page.getByLabel('Add or replace PDF').setInputFiles({name:'my-cv.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByText('Profile updated for this preview.')).toBeVisible();
  await navigate(page,'/about');
  await expect(page.getByRole('heading',{name:'Test Maker'})).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('An introduction written by the user.');
  await page.getByRole('tab',{name:'Skills',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('JavaScript');
  await page.getByRole('tab',{name:'Contact',exact:true}).click();
  await expect(page.getByRole('tabpanel').getByRole('link')).toHaveAttribute('href','mailto:maker@example.com');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download CV'}).first().click();
  expect((await download).suggestedFilename()).toBe('my-cv.pdf');
  await navigate(page,'/'); await navigate(page,'/about');
  await expect(page.getByRole('heading',{name:'Test Maker'})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
});
test('unsaved changes are protected and preferences apply to new projects',async({page})=>{
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Unsaved work');
  await page.getByRole('link',{name:'Preview',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Unsaved work');
  await page.getByRole('button',{name:'Access & security'}).click();
  await page.getByRole('button',{name:'Leave page'}).click();
  await page.getByLabel('Default permission for future downloads').selectOption('none');
  await page.getByRole('button',{name:'Save preference'}).click();
  await expect(page.getByText('Download preference updated for this preview.')).toBeVisible();
  await page.getByRole('button',{name:/^Projects/}).click();
  await expect(page.getByLabel('Download permission')).toHaveValue('none');
});
test('account forms validate, toggle password, and explain pending backend',async({page})=>{
  await navigate(page,'/signin');
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByLabel('Password',{exact:true}).fill('password123');
  await page.getByRole('button',{name:'Show',exact:true}).click();
  await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Sign in to your gallery'}).click();
  await expect(page.locator('#auth-feedback')).toContainText('authentication is connected');
  await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Continue with GitHub'}).click();
  await expect(page.getByRole('dialog')).toContainText('No account connection has been made');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await navigate(page,'/reset');await page.getByLabel('Email address').fill('test@example.com');
  await page.getByRole('button',{name:'Request reset link'}).click();
  await expect(page.locator('#auth-feedback')).toContainText('No email was sent');
});
test('state controls and keyboard tabs work',async({page})=>{
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('heading',{name:/Ideas. Unboxed./})).toBeVisible();
  await navigate(page,'/states');
  await page.getByRole('button',{name:'Preview loading'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible({timeout:5000});
  await page.getByRole('button',{name:'Try again'}).click();
  await expect(page).toHaveURL(/#\/$/);
  await navigate(page,'/about');
  await page.getByRole('tab',{name:'About',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Experience',exact:true})).toHaveAttribute('aria-selected','true');

});
