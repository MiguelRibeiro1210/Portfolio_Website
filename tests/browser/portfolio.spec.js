import { samplePdf } from '../cv-fixture.js';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console', message => {
    const expectedAuthFailure = /\/api\/(login|refresh)$/.test(message.location().url) &&
      message.text().includes('401');
    if (message.type() === 'error' && !expectedAuthFailure && !(page.__allowNetworkFailure && message.text().includes('net::ERR_CONNECTION_FAILED'))) errors.push(message.text());
  });
  page.__errors=errors;
  await page.goto('/#/signin');
  await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  await page.getByRole('navigation').getByRole('link',{name:'Showroom',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Your Projects/})).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

async function navigate(page,hash) {
  await page.evaluate(value=>{location.hash=value;},hash);
  await expect(page.locator('main')).toBeVisible();
}
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5qEAAAAASUVORK5CYII=', 'base64');
const archive = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
async function ensureSignedIn(page) {
  test.skip(!process.env.TEST_DATABASE_URL, 'Project workflows require the isolated test database.');
  if (await page.getByRole('button', { name: 'Sign out' }).count()) return;
  const email = `projects-${randomUUID()}@example.com`;
  const response = await page.request.post('/api/register', { data: { name: 'Project Maker', email, password: 'sample-password' } });
  expect(response.status()).toBe(201);
  await navigate(page, '/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('sample-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}
async function saveProject(page,{title='A real project',type='open',permission='public'}={}) {
  await ensureSignedIn(page);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill(title);
  await page.locator(`input[name=type][value=${type}]`).check();
  await page.getByLabel('Short description').fill('A project added through the local editor.');
  await page.getByLabel('Technology 1', { exact: true }).fill('JavaScript');
  await page.getByRole('button', { name: 'Add technology' }).click();
  await page.getByLabel('Technology 2', { exact: true }).fill('CSS');
  await page.locator('#media-input').setInputFiles({ name: 'project.png', mimeType: 'image/png', buffer: image });
  await page.getByLabel('Download permission').selectOption(permission);
  await page.getByLabel('Show in the collection').check();
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page).toHaveURL(/#\/studio\/[\w-]+$/);
  await expect(page.locator('.draft-chip.active')).toContainText(title);
  return page.url().split('/studio/')[1];
}
test('all pages render and remain inside the viewport', async ({page}, testInfo) => {
  for(const path of ['/','/project/missing','/about','/studio','/studio?section=profile','/studio?section=security','/signin','/register','/reset','/does-not-exist']) {
    await navigate(page,path);
    await expect(page.locator('body')).toHaveAttribute('data-page', path.split(/[/?]/)[1] || 'home');
    await expect(page.locator('h1')).toBeVisible();
    if (path === '/studio') await expect(page.getByRole('heading', { name: 'This studio is private.' })).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),path).toBe(true);
    if(path==='/') {
      await expect(page.locator('.showroom-heading h1')).toHaveText('Your Projects');
      await expect(page.locator('.site-header')).toHaveCSS('background-color','rgb(245, 245, 242)');
      await expect(page.locator('body')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(page.getByRole('heading', { name: 'No published projects yet.' })).toBeVisible();
      await expect(page.locator('.featured-project, .project-card')).toHaveCount(0);
    }
    if (['/','/project/missing','/studio','/about','/signin'].includes(path)) {
      await page.screenshot({path:testInfo.outputPath(`${path.replaceAll('/','-')||'home'}.png`), fullPage:true});
    }
    const viewport=page.viewportSize();
    await page.setViewportSize({width:320,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`320px: ${path}`).toBe(true);
    await page.setViewportSize(viewport);
  }
  await navigate(page,'/');
  await ensureSignedIn(page);
  await navigate(page, '/');
  await page.getByRole('link', { name: 'Create your first project' }).click();
  await expect(page.getByLabel('Project title')).toBeVisible();
});
test('create a project, filter the collection, and reload saved details',async ({page})=>{
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
  await page.getByRole('tab',{name:'Technical details'}).click();
  await expect(page.getByRole('tabpanel').locator('.tech-tag')).toHaveText(['JavaScript', 'CSS']);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('A real project');
  await expect(page.locator('.media-view img')).toBeVisible();
  await navigate(page,`/studio/${id}`);
  await expect(page.getByLabel('Project title')).toHaveValue('A real project');
  await expect(page.getByLabel('Project title')).toBeEnabled();
});
test('edit a saved project, keep and reorder its media, then confirm deletion', async ({ page }, testInfo) => {
  const id = await saveProject(page, { title: 'Original project' });
  await expect(page.getByLabel('Project title')).toHaveValue('Original project');
  await page.screenshot({ path: testInfo.outputPath('studio.png'), fullPage: true });
  const gallery = page.locator('#pending-media');
  const existing = gallery.locator('[data-file-row]').first();
  const firstId = await existing.getAttribute('data-file-row');
  const fileName = (await existing.locator('span').first().innerText()).trim();
  await page.getByLabel('Project title').fill('Updated project');
  await page.locator('#media-input').setInputFiles({ name: 'added.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button', { name: 'Move added.png earlier' }).click();
  const update = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/projects/${id}`));
  await page.getByRole('button', { name: 'Save changes' }).click();
  expect((await update).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel('Project title')).toHaveValue('Updated project');
  await expect(gallery.locator('[data-file-row]').first()).toContainText('added.png');
  await expect(gallery.locator('[data-file-row]').last()).toContainText(fileName);
  await expect(gallery.locator('[data-file-row]').last()).toHaveAttribute('data-file-row', firstId);

  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Updated project');
  await page.getByRole('button', { name: 'Delete project', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page).toHaveURL(/#\/studio$/);
  await expect(page.locator('.draft-chip')).toHaveCount(0);
});

test('a signed-out visitor can open a shared showroom and its published project', async ({ page, browser }) => {
  const id = await saveProject(page, { title: 'Shared project' });
  await expect(page.getByLabel('Project title')).toHaveValue('Shared project');
  await navigate(page, '/');
  const publicLink = await page.getByRole('link', { name: 'View public showroom' }).getAttribute('href');
  const url = new URL(publicLink, page.url()).href;
  const visitor = await browser.newPage();
  try {
    await visitor.goto(url);
    await expect(visitor.getByRole('heading', { name: 'Shared project' }).first()).toBeVisible();
    await expect(visitor.locator('.featured-preview img')).toBeVisible();
    await visitor.getByRole('link', { name: 'Explore project' }).click();
    await expect(visitor).toHaveURL(`${url}/${id}`);
    await expect(visitor.getByRole('heading', { name: 'Shared project', exact: true, level: 1 })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Edit project' })).toHaveCount(0);
    await expect(visitor.locator('.project-stage img')).toBeVisible();
    await visitor.getByRole('navigation').getByRole('link', { name: 'Showroom', exact: true }).click();
    await expect(visitor).toHaveURL(url);
  } finally { await visitor.close(); }
  await page.goto(`${url}/${id}`);
  await expect(page.getByRole('link', { name: 'Edit project' })).toBeVisible();
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
test('fresh visits start at the public feed and explicit page links remain available',async ({page})=>{
  await page.goto('/');
  await expect(page).toHaveURL(/#\/feed$/);
  await expect(page.getByRole('heading',{name:/Discover what’s/})).toBeVisible();
  await page.getByRole('navigation').getByRole('link',{name:'Showroom',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your Projects'})).toBeVisible();
  await page.goto('/#/about');
  await expect(page.getByRole('heading',{name:'Behind the projects.'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Behind the projects.'})).toBeVisible();
});
test('saved projects and files survive reload without browser storage',async ({page})=>{
  await page.addInitScript(() => {
    for (const name of ['indexedDB','localStorage','sessionStorage']) {
      Object.defineProperty(window,name,{get(){throw new Error(`Unexpected browser storage access: ${name}`);}});
    }
  });
  await page.reload();
  const id=await saveProject(page,{title:'Persistent project'});
  await page.reload();
  await expect(page.getByLabel('Project title')).toHaveValue('Persistent project');
  await navigate(page,'/');
  await expect(page.locator('.project-card')).toContainText('Persistent project');
  await navigate(page,`/project/${id}`);
  await expect(page.locator('.media-view img')).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page).toHaveURL(/#\/feed$/);
  await page.goto(`/#/project/${id}`);
  await expect(page.getByRole('heading',{name:'This room is empty.'})).toBeVisible();
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
test('optional notes and build are saved with ordered gallery media and owner downloads',async ({page})=>{
  await ensureSignedIn(page);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Media project');
  await page.getByLabel('Short description').fill('A gallery and a release.');
  await page.getByLabel('Technology 1', { exact: true }).fill('JavaScript');
  await page.getByLabel('Download permission').selectOption('none');
  await page.locator('summary').click();
  await page.getByLabel('The idea',{exact:true}).fill('A saved idea.');
  await page.getByLabel('Release notes',{exact:true}).fill('First release.');
  await page.locator('#media-input').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image}]);
  await page.locator('#build-input').setInputFiles({name:'release.zip',mimeType:'application/zip',buffer:archive});
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page).toHaveURL(/#\/studio\/[\w-]+$/);
  const id=page.url().split('/studio/')[1];
  await page.reload();
  await navigate(page,`/project/${id}`);
  await expect(page.locator('.project-story')).toHaveText('A saved idea.');
  await expect(page.locator('.media-view img')).toBeVisible();
  await expect(page.locator('.media-view img')).toHaveAttribute('alt','first.png');
  await page.getByRole('button',{name:'View second.png'}).click();
  await expect(page.locator('.media-view img')).toHaveAttribute('alt','second.png');
  await page.getByRole('tab',{name:'Release notes'}).click();
  await expect(page.getByRole('tabpanel')).toContainText('First release.');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'release.zip'}).click();
  expect((await download).suggestedFilename()).toBe('release.zip');
});

test('drafts stay in the studio and cancelling does not create a project',async ({page})=>{
  await ensureSignedIn(page);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Unsaved project');
  await page.getByRole('link',{name:'Preview',exact:true}).click();
  await page.getByRole('button',{name:'Leave page'}).click();
  await expect(page.locator('.draft-chip')).toHaveCount(0);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Draft project');
  await page.getByLabel('Short description').fill('Not in the collection.');
  await page.getByLabel('Technology 1', { exact: true }).fill('CSS');
  await page.locator('#media-input').setInputFiles({name:'draft.png',mimeType:'image/png',buffer:image});
  await page.getByLabel('Show in the collection').uncheck();
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('.draft-chip')).toContainText('Draft');
  await page.reload();
  await expect(page.locator('.draft-chip')).toContainText('Draft project');
  await navigate(page,'/');
  await expect(page.locator('.project-card')).not.toContainText(['Draft project']);
});

test('a failed submission retains fields and files and can be retried',async ({page})=>{
  await ensureSignedIn(page);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Retry project');
  await page.getByLabel('Short description').fill('Keep these details.');
  await page.getByLabel('Technology 1', { exact: true }).fill('JavaScript');
  await page.getByRole('button', { name: 'Add technology' }).click();
  await page.getByLabel('Technology 2', { exact: true }).fill('Spring Boot');
  await page.locator('#media-input').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:image});
  // Simulate a dropped response before any backend mutation.
  await page.route('**/api/projects', route => route.abort('connectionfailed'), { times: 1 });
  page.__allowNetworkFailure = true;
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Retry project');
  await expect(page.locator('#pending-media')).toContainText('retry.png');
  await expect(page.getByLabel('Technology 2', { exact: true })).toHaveValue('Spring Boot');
  await expect(page.getByRole('button',{name:'Save changes'})).toBeEnabled();
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('.draft-chip.active')).toContainText('Retry project');
});
test('profile saves once, persists after reload, and visitors can download the CV',async ({page, browser})=>{
  await ensureSignedIn(page);
  await navigate(page,'/about');
  await expect(page.getByText('Your name', {exact:true})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  await navigate(page,'/studio?section=profile');
  await page.getByLabel('Name',{exact:true}).fill('Test Maker');
  await page.getByLabel('Role',{exact:true}).fill('Developer');
  await page.getByLabel('About',{exact:true}).fill('An introduction written by the user.');
  await page.getByLabel('Skills',{exact:true}).fill('JavaScript, CSS');
  await page.getByLabel('Contact email').fill('maker@example.com');
  await page.getByLabel('Add or replace PDF').setInputFiles({name:'my-cv.pdf',mimeType:'application/pdf',buffer:samplePdf()});
  const saves = [];
  page.on('request', request => { if (request.method() === 'PUT') saves.push(new URL(request.url()).pathname); });
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect(saves).toEqual(['/api/profile/me']);
  const publicLink = await page.getByRole('link', { name: 'View public profile' }).getAttribute('href');
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Test Maker');
  const visitor = await browser.newPage();
  try {
    await visitor.goto(new URL(publicLink, page.url()).href);
    await expect(visitor.getByRole('heading', { name: 'Test Maker' })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Edit CV' })).toHaveCount(0);
    await expect(visitor.getByRole('link', { name: 'Preview CV' })).toBeVisible();
  } finally { await visitor.close(); }
  await navigate(page,'/about');
  await expect(page.getByRole('heading',{name:'Test Maker'})).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('An introduction written by the user.');
  await page.getByRole('tab',{name:'Skills',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('JavaScript');
  await page.getByRole('tab',{name:'Contact',exact:true}).click();
  await expect(page.getByRole('tabpanel').getByRole('link')).toHaveAttribute('href','mailto:maker@example.com');
  const downloadLink = page.getByRole('link', { name: 'Download CV', exact: true });
  const href = await downloadLink.getAttribute('href');
  expect(href).toMatch(/^\/api\/profiles\/[^/]+\/cv\?download=1$/);
  const downloadUrl = new URL(href, page.url()).href;
  // Browsers without inline PDF support can also download the iframe preview.
  const [download] = await Promise.all([
    page.waitForEvent('download', event => event.url() === downloadUrl),
    downloadLink.click(),
  ]);
  expect(download.suggestedFilename()).toBe('my-cv.pdf');
  await navigate(page,'/'); await navigate(page,'/about');
  await expect(page.getByRole('heading',{name:'Test Maker'})).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
});
test('unsaved changes are protected and preferences apply to new projects',async({page})=>{
  await ensureSignedIn(page);
  await navigate(page,'/studio');
  await page.getByLabel('Project title').fill('Unsaved work');
  await page.getByRole('link',{name:'Preview',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Project title')).toHaveValue('Unsaved work');
  await page.getByRole('button',{name:'Access & security'}).click();
  await page.getByRole('button',{name:'Leave page'}).click();
  const defaultPermission = page.getByLabel('Default permission for future downloads');
  await expect(defaultPermission.locator('option')).toHaveText(['Downloads disabled', 'All visitors']);
  await expect(defaultPermission).toHaveValue('none');
  await defaultPermission.selectOption('public');
  await page.getByRole('button',{name:'Save preference'}).click();
  await expect(page.getByText('Download preference updated for this preview.')).toBeVisible();
  await page.getByRole('button',{name:/^Projects/}).click();
  const downloadPermission = page.getByLabel('Download permission');
  await expect(downloadPermission.locator('option')).toHaveText(['Downloads disabled', 'All visitors']);
  await expect(downloadPermission).toHaveValue('public');
});
test('dark mode applies immediately and persists across reloads', async ({ page }) => {
  await ensureSignedIn(page);
  await navigate(page, '/studio?section=security');
  const darkMode = page.getByRole('switch', { name: 'Dark mode' });
  const root = page.locator('html');
  await expect(darkMode).not.toBeChecked();
  await darkMode.press('Space');
  await expect(root).toHaveCSS('background-color', 'rgb(21, 23, 25)');
  await page.reload();
  await expect(darkMode).toBeChecked();
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await darkMode.click();
  await page.reload();
  await expect(darkMode).not.toBeChecked();
  await expect(root).toHaveCSS('background-color', 'rgb(245, 245, 242)');
});

test('account forms show invalid credentials and explain an unconfigured provider and pending reset flow',async({page})=>{
  await navigate(page,'/signin');
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveCount(0);
  await page.getByLabel('Email address').fill(`missing-${randomUUID()}@example.com`);
  await page.getByLabel('Password',{exact:true}).fill('password123');
  await page.getByRole('button',{name:'Show',exact:true}).click();
  await expect(page.getByLabel('Password',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Sign in'}).click();
  await expect(page.locator('#auth-feedback')).toContainText('Invalid email or password.');
  await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  await page.getByRole('link',{name:'Continue with GitHub'}).click();
  await expect(page.locator('#auth-feedback')).toContainText('This sign-in provider is not configured.');
  await navigate(page,'/reset');await page.getByLabel('Email address').fill('test@example.com');
  await page.getByRole('button',{name:'Request reset link'}).click();
  await expect(page.locator('#auth-feedback')).toContainText('No email was sent');
});
test('sign-in survives reload and sign-out ends the browser session', async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to exercise real authentication.');
  const email = `browser-${randomUUID()}@example.com`;
  const password = 'sample-password';
  const registered = await page.request.post('/api/register', {
    data: { name: 'Browser Test', email, password },
  });
  expect(registered.status()).toBe(201);

  await navigate(page, '/signin');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/feed$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/#\/feed$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Discover what’s/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});

test('keyboard navigation works and the system states preview is inaccessible',async({page})=>{
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('heading',{name:/Your Projects/})).toBeVisible();
  await expect(page.getByRole('link', { name: 'System states' })).toHaveCount(0);
  await navigate(page, '/states');
  await expect(page.getByRole('heading', { name: 'Let’s head back to the gallery.' })).toBeVisible();
  await navigate(page,'/about');
  await page.getByRole('tab',{name:'About',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Projects',exact:true})).toHaveAttribute('aria-selected','true');

});

test('technology fields persist as chips and long showroom copy stays compact', async ({ page, browser }, info) => {
  const id = await saveProject(page, { title: 'Compact showroom project' });
  const description = 'A deliberately long description that belongs on the project page. '.repeat(45).trim();
  const story = 'The complete project story is available in the detailed view. '.repeat(35).trim();
  await page.getByLabel('Short description').fill(description);
  await page.locator('.more-details summary').click();
  await page.getByLabel('The idea', { exact: true }).fill(story);
  await page.getByLabel('Technology 1', { exact: true }).fill('Spring Boot');
  await page.getByLabel('Technology 2', { exact: true }).fill('Temporary');
  await page.getByRole('button', { name: 'Remove technology 2', exact: true }).click();
  await expect(page.getByLabel('Technology 1', { exact: true })).toBeFocused();
  for (const [index, value] of ['React (TypeScript)', 'Tauri', 'Java 17', 'H2'].entries()) {
    await page.getByRole('button', { name: 'Add technology', exact: true }).click();
    const input = page.getByLabel(`Technology ${index + 2}`, { exact: true });
    await expect(input).toBeFocused();
    await input.fill(value);
  }
  await page.getByRole('button', { name: 'Add technology', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Project saved.', { exact: true }).last()).toBeVisible();
  await page.reload();
  await expect(page.locator('[name=technology]')).toHaveCount(5);
  await expect(page.getByLabel('Technology 2', { exact: true })).toHaveValue('React (TypeScript)');
  await navigate(page, '/');
  await expect(page.locator('.featured-description')).toHaveText(description);
  await expect(page.locator('.featured-story')).toHaveCount(0);
  const height = await page.locator('.featured-description').evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(height.height).toBeLessThanOrEqual(height.lineHeight * 4 + 2);
  const cardHeight = await page.locator('.project-card > p:not(.eyebrow)').evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(cardHeight.height).toBeLessThanOrEqual(cardHeight.lineHeight * 4 + 2);
  await expect(page.locator('.featured-links .tech-tag')).toHaveCount(5);
  await expect(page.locator('.featured-links')).toContainText('+1 more');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-showroom.png'), fullPage: true });
  const publicLink = await page.getByRole('link', { name: 'View public showroom' }).getAttribute('href');
  const visitor = await browser.newPage();
  try {
    await visitor.goto(new URL(publicLink, page.url()).href);
    await expect(visitor.locator('.featured-story')).toHaveCount(0);
    await visitor.getByRole('link', { name: 'Explore project' }).click();
    await expect(visitor.locator('.project-story')).toHaveText(story);
    await expect(visitor.getByText(description, { exact: true })).toBeVisible();
    await visitor.getByRole('tab', { name: 'Technical details' }).click();
    await expect(visitor.locator('.tech-tag')).toHaveText(['Spring Boot', 'React (TypeScript)', 'Tauri', 'Java 17', 'H2']);
    await visitor.goto('/#/feed');
    const post = visitor.locator('.feed-post').filter({ has: visitor.getByRole('heading', { name: 'Compact showroom project', exact: true }) });
    await expect(post.locator('.tech-tag')).toHaveText(['Spring Boot', 'React (TypeScript)', 'Tauri', 'Java 17', 'H2']);
  } finally { await visitor.close(); }
  await navigate(page, `/studio/${id}`);
  await page.getByLabel('Technology 1', { exact: true }).fill('Java, React');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Use a separate field for each technology.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Technology 1', { exact: true })).toHaveValue('Java, React');
});

test('security buttons use server provider state after reload and OAuth callbacks', async ({ page }) => {
  await ensureSignedIn(page);
  let linkedProviders = [];
  await page.route('**/api/me', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { user: { ...body.user, linkedProviders } } });
  });
  for (const providers of [[], ['google'], ['github'], ['google', 'github']]) {
    linkedProviders = providers;
    await page.goto('/#/studio?section=security&oauth=linked');
    await page.reload();
    for (const [provider, name] of [['google', 'Google'], ['github', 'GitHub']]) {
      if (providers.includes(provider)) {
        await expect(page.getByRole('button', { name: `${name} connected`, exact: true })).toBeDisabled();
        await expect(page.locator(`form[action="/api/oauth/${provider}/link"]`)).toHaveCount(0);
      } else await expect(page.getByRole('button', { name: `Connect ${name}`, exact: true })).toBeEnabled();
    }
  }
  linkedProviders = ['google'];
  await page.goto('/#/studio?section=security&oauth=failed');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect GitHub', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Google connected', exact: true })).toBeDisabled();
});
