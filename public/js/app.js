import { loadFeedBundle } from './feed-loader.js';
import { repository, emptyWorkspace, registerAccount, signIn, restoreSession, signOut, createProject, loadProject, updateProject, deleteProject, rememberProject, loadOwnerProfile, saveOwnerProfile, loadPublicProfile, publicCvUrl, showroomPath, showroomFileUrl, loadOwnerShowroom, loadShowroom, feedRequest } from './api.js';
import { showroom, projectPage, studio } from './project.js';
import { aboutPage } from './cv.js';
import { authPage } from './auth.js';
import { escapeHTML as e, icon, link, button, notify, modal, confirmAction } from './ui.js';

let state = emptyWorkspace();
let account = null;
let feedView = null, renderGeneration = 0, workspaceLoadedFor = null;
function syncFeedAccount() {
  if (route().page !== 'feed') return;
  feedView?.updateAccount(account);
  const heading = document.querySelector('.site-header');
  if (heading) heading.outerHTML = header('feed');
  const foot = document.querySelector('.site-footer');
  if (foot) foot.outerHTML = footer();
}
let featuredIndex = 0;
let savingProject = false, savingProfile = false, workspaceError = '', profileError = '';
let aboutLoad, editorLoad, visitorLoad;
let ownerShowroomId = null;
let visitorProjects = [];

async function loadShowroomView(showroomId, projectId) {
  const data = await loadShowroom(showroomId, projectId);
  if (!data) return null;
  const profile = data.showroom.profileId
    ? await loadPublicProfile(data.showroom.profileId).catch(() => null) : null;
  return { ...data, profile };
}

function featuredCount() {
  const projects = route().showroomId ? visitorProjects : state.projects;
  return projects.filter(project => project.published).length;
}

function rememberWorkspaceProject(project) {
  const index = state.projects.findIndex(item => item.id === project.id);
  if (index < 0) state.projects.push(project);
  else state.projects[index] = project;
}
async function loadProfile() {
  const ownerId = account?.id;
  if (!ownerId) return;
  try {
    const profile = await loadOwnerProfile();
    if (account?.id !== ownerId) return;
    state.profile = profile; profileError = '';
  } catch (error) { if (account?.id === ownerId) profileError = error.message; }
}

async function loadWorkspace() {
  const ownerId = account?.id;
  if (!ownerId) return;
  try {
    const loaded = await repository.load();
    const showroomId = await loadOwnerShowroom().catch(() => null);
    if (account?.id !== ownerId) return;
    state = loaded; workspaceError = ''; ownerShowroomId = showroomId;
    workspaceLoadedFor = ownerId;
  } catch (error) {
    if (account?.id === ownerId) { workspaceError = error.message; workspaceLoadedFor = null; }
  }
}
let filter = 'all', projectTab = 'specs', aboutTab = 'about', mediaIndex = 0;
let pendingFiles = [], removedFiles = new Set(), dirty = false, activeUrls = [];
window.addEventListener('session-ended', () => { account = null; state = repository.reset(); workspaceLoadedFor = null; ownerShowroomId = null; syncFeedAccount(); });
const app = document.querySelector('#app');
// The discovery feed is public; explicit showroom, studio and account routes keep their destinations.
if (!location.hash || location.hash === '#') history.replaceState(null, '', `${location.pathname}${location.search}#/feed`);
let wheelDistance = 0, lastWheelAt = 0, slideLockedUntil = 0;
let swipeStart = null;
function route() {
  const [path,query=''] = (location.hash.slice(1)||'/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  if (parts[0] === 'showroom' && parts[1] && parts.length <= 3) {
    return { page: parts[2] ? 'project' : 'home', showroomId: parts[1], id: parts[2] };
  }
  return { page: parts[0] || 'home', id: parts[1], section: params.get('section') || 'projects', oauth: params.get('oauth'), showroom: params.get('showroom') };
}
function header(page, profile = state.profile, ownProfile = true, visitor = null) {
  const auth = ['signin', 'register', 'reset'].includes(page);
  const editor = page === 'studio';
  const current = route();
  const project = state.projects.find(item => item.id === current.id);
  const collection = visitor ? showroomPath(visitor.id) : '#/';
  const about = visitor ? visitor.profileId && `#/about/${encodeURIComponent(visitor.profileId)}?showroom=${encodeURIComponent(visitor.id)}` : '#/about';
  const editableProject = page === 'project' && (visitor ? visitor.owner && visitor.projectId : account && project?.id);
  const editId = visitor ? visitor.projectId : project?.id;
  const canEditCv = page === 'about' && account && ownProfile;

  return `<header class="site-header">
    <a class="wordmark" href="#/feed" aria-label="folio home">folio</a>
    <nav class="nav-left" aria-label="Main navigation">
      ${link('Discover', '#/feed', `nav-link ${page === 'feed' ? 'current' : ''}`)}
      <a class="nav-link ${page === 'home' ? 'current' : ''}" href="${collection}">Showroom</a>
      ${about ? `<a class="nav-link ${page === 'about' ? 'current' : ''}" href="${about}">About</a>` : ''}
    </nav>
    <div class="nav-right">
      ${editor ? link('Preview', '#/', 'nav-secondary', 'external') : ''}
      ${editableProject ? link('Edit project', `#/studio/${encodeURIComponent(editId)}`, 'nav-secondary') : ''}
      ${canEditCv ? link('Edit CV', '#/studio?section=profile', 'nav-secondary') : ''}
      ${auth && page === 'signin' ? link('Create an account', '#/register', 'nav-secondary', 'external') : ''}
      ${account
        ? `${!editor ? link('My studio', '#/studio', 'nav-studio', 'external') : ''}
          <button type="button" class="text-btn nav-account" data-action="signout">Sign out</button>`
        : auth ? '' : link('Sign in', '#/signin', 'nav-studio')}
    </div>
  </header>`;
}

function footer(visitor = null) {
  return `<footer class="site-footer">
    <a href="#/feed">folio / Built to be seen.</a>
    <div>
      ${account && ownerShowroomId && !visitor ? `<a href="${showroomPath(ownerShowroomId)}">View public showroom ↗</a>` : ''}
      <span>© ${new Date().getFullYear()} folio</span>
      ${button('Privacy', 'privacy', 'text-btn')} ${button('Terms', 'terms', 'text-btn')}
    </div>
  </footer>`;
}

function stateCard(kind, action) {
  const variants = {
    loading: ['Loading', 'Good work is on its way.', 'Loading the latest projects. Just a moment.'],
    maintenance: ['Temporarily unavailable', 'A brief intermission.', 'This page is temporarily unavailable. Try again in a moment.'],
  };
  const [label, title, description] = variants[kind];
  const illustration = kind === 'loading'
    ? '<div class="skeleton s-art"></div><div class="skeleton s-title"></div><div class="skeleton s-sub"></div>'
    : `<span class="state-symbol">[ pause ]</span>`;
  return `<section class="state-card ${kind}"><p class="eyebrow">${label}</p>
    <div class="state-illustration" aria-hidden="true">${illustration}</div>
    <h2>${title}</h2><p>${description}</p>${action || ''}</section>`;
}

function accessState() {
  return `<section class="access-state"><div><p class="eyebrow">Access restricted</p><h2>This studio is private.</h2></div>
    <p>Only the owner can make changes.</p>
    ${link(account ? 'Go to my studio' : 'Sign in to your studio', account ? '#/studio' : '#/signin', '', 'arrow')}
  </section>`;
}

const oauthMessages = new Map([
  ['unavailable', 'This sign-in provider is not configured.'],
  ['signin-required', 'Sign in before connecting a provider.'],
  ['cancelled', 'The provider did not complete the request.'],
  ['email-required', 'A verified primary email is required to create a new account.'],
  ['link-required', 'An account already uses that email. Sign in to it, then connect the provider in Access & security.'],
  ['linked', 'Sign-in provider connected.'],
  ['already-linked', 'That identity is already linked, or this account already uses that provider.'],
  ['failed', 'Could not complete provider sign-in. Please try again.'],
]);

async function render() {
  const generation = ++renderGeneration;
  feedView?.unmount(); feedView = null;
  activeUrls.forEach(URL.revokeObjectURL); activeUrls=[];
  if (account && route().page === 'signin' && !route().oauth) {
    history.replaceState(null, '', '#/feed');
    previousHash = location.hash;
  }
  const r=route();
  if (r.page === 'feed') {
    document.body.dataset.page = 'feed';
    document.title = 'Discover — folio';
    app.innerHTML = `${header('feed')}<main id="main" tabindex="-1"><div id="feed-root"><p class="section-pad" role="status">Loading the discovery feed…</p></div></main>${footer()}`;
    dirty = false; pendingFiles = []; removedFiles.clear();
    const container = document.querySelector('#feed-root');
    try {
      const { mountFeed } = await loadFeedBundle();
      if (generation !== renderGeneration || !container.isConnected) return;
      feedView = mountFeed(container, { request: feedRequest, account });
    } catch (error) {
      if (generation === renderGeneration && container.isConnected) container.innerHTML = `<section class="section-pad state-single"><h1>Discover</h1><p role="alert">${e(error.message)}</p>${button('Retry loading feed', 'reload-feed')}</section>`;
    }
    return;
  }
  if (account && !r.showroomId && ['home', 'studio', 'about', 'project'].includes(r.page) && workspaceLoadedFor !== account.id) {
    await loadWorkspace();
    await loadProfile();
    if (generation !== renderGeneration) return;
  }
  const renderedHash = location.hash;
  const isEditing = r.page === 'studio' && r.section === 'projects' && r.id && account;
  let editorError = '';
  if (isEditing) {
    if (editorLoad?.id !== r.id) {
      app.innerHTML = `<main class="initial-loading section-pad" id="main" tabindex="-1" aria-busy="true" role="status">${stateCard('loading')}</main>`;
      editorLoad = { id: r.id, result: loadProject(r.id) };
    }
    try {
      const project = await editorLoad.result;
      if (renderedHash !== location.hash) return;
      rememberWorkspaceProject(project);
      rememberProject(project);
    } catch (error) {
      if (renderedHash !== location.hash) return;
      editorError = error.message;
      if (error.status === 404) state.projects = state.projects.filter(project => project.id !== r.id);
    }
  }
  let profile = state.profile;
  let visitor = null;
  let visitorIssue = '';
  let projects = state.projects;
  if (r.showroomId) {
    const key = JSON.stringify([r.showroomId, r.id]);
    if (visitorLoad?.key !== key) {
      app.innerHTML = `<main class="initial-loading section-pad" id="main" tabindex="-1" role="status">${stateCard('loading')}</main>`;
      visitorLoad = { key, result: loadShowroomView(r.showroomId, r.id) };
    }
    let data;
    try { data = await visitorLoad.result; }
    catch { visitorIssue = 'retry'; }
    if (renderedHash !== location.hash) return;
    visitor = { id: r.showroomId, profileId: data?.showroom.profileId,
      owner: Boolean(account && ownerShowroomId === r.showroomId),
      projectId: r.id && data?.projects[0]?.id };
    projects = visitorProjects = data?.projects ?? [];
    profile = data?.profile ?? emptyWorkspace().profile;
    if (!data && !visitorIssue) visitorIssue = 'missing';
  }
  let missingProfile = false;
  let profileShowroom = null;
  const ownProfile = Boolean(account && (!r.id || r.id === state.profile.publicId));
  if (r.page === 'about' && r.id) {
    if (aboutLoad?.key !== renderedHash) {
      aboutLoad = {
        key: renderedHash,
        result: Promise.all([
          loadPublicProfile(r.id),
          r.showroom ? loadShowroom(r.showroom).catch(() => null) : null,
        ]),
      };
    }
    try {
      const [saved, related] = await aboutLoad.result;
      projects = [];
      if (related?.showroom.profileId === r.id) {
        profileShowroom = related.showroom;
        projects = related.projects;
      } else if (ownProfile) projects = state.projects;
      profile = saved ?? emptyWorkspace().profile;
      missingProfile = !saved;
    } catch (error) {
      aboutLoad = undefined;
      profile = emptyWorkspace().profile;
      missingProfile = true;
      notify(error.message);
    }
    if (renderedHash !== location.hash) return;
  }
  document.body.dataset.page=r.page;
  const oauthStatus = oauthMessages.get(r.oauth) ?? '';
  const viewState = { ...state, profile, projects };
  const content = visitorIssue === 'retry'
    ? `<section class="section-pad state-single"><h1 class="eyebrow">Showroom unavailable</h1>${stateCard('maintenance', button('Try again', 'reload-showroom'))}</section>`
    : visitorIssue === 'missing' ? '<section class="section-pad"><h1>Showroom not found.</h1></section>'
    : r.page==='home'?showroom(viewState,filter,featuredIndex,visitor):r.page==='project'?projectPage(viewState,r.id,projectTab,mediaIndex,visitor):r.page==='about'?(missingProfile ? '<section class="section-pad"><h1>Profile not found.</h1></section>'
    : aboutPage({ profile, projects }, aboutTab, ownProfile, profileShowroom)):r.page==='studio'?(!account
    ? `<div class="section-pad state-single"><h1 class="eyebrow">Project studio</h1>${accessState()}</div>`
    : editorError
    ? `<section class="section-pad"><h1>Could not open project.</h1><p role="alert">${e(editorError)}</p>${button('Retry loading project','reload-project')}</section>`
    : studio(state,r.id,r.section,account,oauthStatus,profileError,ownerShowroomId)):['signin','register','reset'].includes(r.page)?authPage(r.page,oauthStatus):`<section class="not-found section-pad"><p class="eyebrow">404 / A LITTLE OFF THE MAP</p><h1>Let’s head back to the gallery.</h1>${link('Explore the projects','#/','primary','arrow')}</section>`;
  app.innerHTML = `${header(r.page, profile, ownProfile, visitor)}<main id="main" tabindex="-1">${workspaceError && !visitor ? `<div class="section-pad" role="alert"><p>${e(workspaceError)}</p>${button('Retry loading projects','reload-projects')}</div>` : ''}${content}</main>${footer(visitor)}`;
  document.title=`${({home:'The collection',project:'Project experience',about:'Behind the projects',studio:'Your workspace',signin:'Sign in',register:'Create your gallery',reset:'Reset password'})[r.page]||'Page not found'} — folio`;
  dirty=false; pendingFiles=[]; removedFiles.clear();
  bindForms();
  for (const container of app.querySelectorAll('[data-media-id]')) {
    if (visitor || profileShowroom) {
      const id = container.dataset.mediaId;
      const project = projects.find(item => item.media.some(file => file.id === id));
      const file = project?.media.find(item => item.id === id);
      if (!file) continue;
      const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'img');
      element.addEventListener('error', () => { container.textContent = 'Media could not be loaded.'; }, { once: true });
      if (element.tagName === 'VIDEO') element.controls = true;
      else element.alt = file.name;
      element.src = showroomFileUrl((visitor || profileShowroom).id, project.id, file.id);
      container.append(element);
      continue;
    }
    try {
      const file = await repository.file(container.dataset.mediaId);
      if (!container.isConnected) break;
      if (!file) { container.textContent='This project file is unavailable.'; continue; }
      const url=URL.createObjectURL(file); activeUrls.push(url);
      const element=document.createElement(file.type.startsWith('video/')?'video':'img');
      element.src=url; if(element.tagName==='VIDEO') element.controls=true; else element.alt=file.name;
      container.append(element);
    } catch(error) { container.textContent='Media could not be loaded.'; }
  }
}
async function updatePreview(next, files=[], removeIds=[]) {
  await repository.save(next,files,removeIds); state=next; dirty=false;
}
function bindForms() {
  const projectForm = document.querySelector('#project-form');
  if(projectForm) {
    projectForm.onsubmit=saveProject;
    if (!account) {
      projectForm.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
    }
    projectForm.onchange=()=>{dirty=true;}; projectForm.oninput=()=>{dirty=true;};
    for (const type of ['media','builds']) {
      const input=document.querySelector(type==='media'?'#media-input':'#build-input');
      input.onchange=()=>{
        const rejected=[];
        let acceptedMedia = 0;
        const countBefore = pendingFiles.length;
        for(const file of input.files) {
          if(file.size>(type==='media'?20:100)*1024*1024) {rejected.push(`${file.name}: file is too large`); continue;}
          if(type==='media' && !['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(file.type)) {rejected.push(`${file.name}: unsupported media type`);continue;}
          if(type==='builds' && !/\.(zip|exe|apk|dmg|deb|appimage|msi|tar|gz)$/i.test(file.name)) {rejected.push(`${file.name}: unsupported release file`);continue;}
          if (type==='builds' && pendingFiles.some(item=>item.category==='builds')) { rejected.push('Select at most one build. Remove the current selection first.'); continue; }
          if (type==='media' && projectForm.querySelector('#pending-media').children.length + acceptedMedia >= 10) { rejected.push('Select at most 10 gallery files.'); continue; }
          const item = { id: crypto.randomUUID(), file, category: type };
          pendingFiles.push(item);
          if (type === 'media') acceptedMedia++;

        }
        if (acceptedMedia || pendingFiles.length !== countBefore) dirty=true;
        input.value=''; renderPending(); if(rejected.length) notify(rejected.join('. '));
      };
    }
  }
  const profileForm=document.querySelector('#profile-form');
  if(profileForm) {
    profileForm.oninput=()=>{dirty=true;}; profileForm.onchange=()=>{dirty=true;};
    profileForm.onsubmit = async event => {
      event.preventDefault();
      if (savingProfile) return;
      const submit = event.submitter;
      submit.disabled = true;
      savingProfile = true;
      try {
        const form = new FormData(profileForm);
        if (!form.get('cv')?.name) form.delete('cv');
        if (form.get('cv')?.size > 10 * 1024 * 1024) throw new Error('Choose a PDF up to 10 MiB.');
        state.profile = await saveOwnerProfile(form);
        aboutLoad = undefined;
        dirty = false;
        notify('Profile saved.');
        await render();
      } catch (error) { notify(error.message); }
      finally {
        savingProfile = false;
        submit.disabled = false;
      }
    };
  }
  const authForm=document.querySelector('#auth-form');
  if (authForm) authForm.onsubmit = async event => {
    event.preventDefault();
    const feedback = authForm.querySelector('#auth-feedback');
    const password = authForm.querySelector('[name="password"]');

    if (authForm.dataset.mode === 'register') {
      const submitButton = authForm.querySelector('[type="submit"]');
      if (submitButton.disabled) return;

      submitButton.disabled = true;
      feedback.textContent = 'Creating your account…';
      try {
        await registerAccount(Object.fromEntries(new FormData(authForm)));
        authForm.reset();
        feedback.textContent = 'Account created successfully.';
      } catch (error) {
        feedback.textContent = error.message || 'Could not create the account.';
      } finally {
        password.value = '';
        submitButton.disabled = false;
      }
      return;
    }

    if (authForm.dataset.mode === 'reset') {
      feedback.textContent = 'No email was sent. Password reset will be available in a future update.';
      return;
    }

    const submitButton = authForm.querySelector('[type="submit"]');
    if (submitButton.disabled) return;

    submitButton.disabled = true;
    feedback.textContent = 'Signing in…';
    try {
      account = await signIn(Object.fromEntries(new FormData(authForm)));
      state = repository.reset();
      workspaceLoadedFor = null;
      if (route().page === 'signin') location.hash = '/feed';
      else await render();
    } catch (error) {
      feedback.textContent = error.message || 'Could not sign in.';
    } finally {
      password.value = '';
      submitButton.disabled = false;
    }
  };
  const settingsForm=document.querySelector('#settings-form');
  if(settingsForm) {
    settingsForm.onchange=()=>{dirty=true;};
    settingsForm.onsubmit=async event=>{
      event.preventDefault(); const submit=event.submitter; submit.disabled=true;
      try { const next=structuredClone(state); next.settings.permission=new FormData(settingsForm).get('permission'); await updatePreview(next); notify('Download preference updated for this preview.'); }
      catch(error) { notify(error.message); } finally { submit.disabled=false; }
    };
  }
}
function safeUrl(value){try{return ['https:','http:'].includes(new URL(value).protocol);}catch{return false;}}
async function saveProject(event) {
  event.preventDefault();
  if (savingProject) return;
  if (!account) { notify('Sign in before saving a project.'); return; }
  const { id } = route();
  const current = state.projects.find(project => project.id === id);
  if (id && !current?.etag) { notify('Reload this project before saving.'); return; }
  const formElement = event.target;
  const submitButton = formElement.querySelector('button[type="submit"]');
  savingProject = true;
  formElement.inert = true;
  submitButton.disabled = true;
  try {
    const form = new FormData(formElement);
    const p = Object.fromEntries(['title','type','description','stack','story','compatibility','source','releaseNotes','permission'].map(key=>[key,String(form.get(key)||'').trim()]));
    p.published = form.has('published');
    if (!p.title || !p.description || !p.stack) throw new Error('Fill in the title, description, and tech stack.');
    if (p.source && !safeUrl(p.source)) throw new Error('Use an HTTP or HTTPS repository URL.');
    const uploads = pendingFiles.filter(item => item.category === 'media');
    const gallery = [...formElement.querySelectorAll('#pending-media [data-file-row]')];
    if (!gallery.length) throw new Error('Add at least one gallery image or video.');
    const uploadIndex = new Map(uploads.map((item, index) => [item.id, index]));
    let saved;
    if (current) {
      p.mediaOrder = gallery.map(row => uploadIndex.has(row.dataset.fileRow)
        ? { uploadIndex: uploadIndex.get(row.dataset.fileRow) }
        : { fileId: row.dataset.fileRow });
      const build = current.builds[0];
      p.buildAction = pendingFiles.some(item => item.category === 'builds') ? 'replace'
        : build && removedFiles.has(build.id) ? 'remove' : 'keep';
      saved = await updateProject(current, p, pendingFiles);
      editorLoad = { id: saved.id, result: Promise.resolve(saved) };
    } else {
      const ordered = gallery.map(row => uploads[uploadIndex.get(row.dataset.fileRow)]);
      saved = await createProject(p, [...ordered, ...pendingFiles.filter(item => item.category === 'builds')]);
    }
    rememberWorkspaceProject(saved);
    dirty = false;
    notify('Project saved.');
    if (current) await render();
    else location.hash = `/studio/${saved.id}`;
  } catch (error) {
    notify(error.message || 'Could not save your project.');
  } finally {
    savingProject = false;
    formElement.inert = false;
    submitButton.disabled = false;
  }
}

function syncGalleryControls() {
  const rows = [...document.querySelectorAll('#pending-media [data-file-row]')];
  rows.forEach((row, index) => {
    row.querySelector('[data-direction="-1"]').disabled = index === 0;
    row.querySelector('[data-direction="1"]').disabled = index === rows.length - 1;
  });
}

function renderPending() {
  const gallery = document.querySelector('#pending-media');
  const visible = new Set([...gallery.children].map(row => row.dataset.fileRow));
  for (const { id, file } of pendingFiles.filter(item => item.category === 'media' && !visible.has(item.id))) {
    gallery.insertAdjacentHTML('beforeend', `<div class="file-row" data-file-row="${id}"><span>${icon('file',16)}${e(file.name)}</span><div>
      <button type="button" class="icon-btn" data-reorder="${id}" data-direction="-1" aria-label="Move ${e(file.name)} earlier">↑</button>
      <button type="button" class="icon-btn" data-reorder="${id}" data-direction="1" aria-label="Move ${e(file.name)} later">↓</button>
      <button type="button" class="icon-btn" data-remove-pending="${id}" aria-label="Remove ${e(file.name)}">${icon('close',16)}</button>
      </div></div>`);
  }
  syncGalleryControls();
  document.querySelector('#pending-builds').innerHTML = pendingFiles.filter(item => item.category === 'builds')
    .map(({ id, file }) => `<div class="file-row"><span>${icon('file',16)}${e(file.name)}</span><button type="button" class="icon-btn" data-remove-pending="${id}" aria-label="Remove ${e(file.name)}">${icon('close',16)}</button></div>`).join('');
}

function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function download(id,name){const file=await repository.file(id);if(!file)throw new Error('This file is unavailable. Add it again in your workspace.');downloadBlob(file,name||file.name);}

async function changeFeatured(step, wrap = true) {
  const count = featuredCount();
  if (count < 2) return;
  const current = featuredIndex % count;
  const next = wrap ? (current + step + count) % count : Math.max(0, Math.min(count - 1, current + step));
  if (next === current) return;
  const focused = document.activeElement;
  const focusStep = focused?.dataset.featureStep;
  const focusCarousel = focused?.matches('.featured-project');
  featuredIndex = next;
  const y = scrollY;
  await render();
  scrollTo(0, y);
  const carousel = document.querySelector('.featured-project');
  if (!carousel) return;
  carousel.style.setProperty('--slide-direction', step > 0 ? 1 : -1);
  carousel.classList.add('slide-enter');
  if (focusStep) carousel.querySelector(`[data-feature-step="${focusStep}"]`)?.focus({preventScroll:true});
  else if (focusCarousel) carousel.focus({preventScroll:true});
}

// Consume one deliberate wheel gesture per slide, then release page scrolling at either end.
document.addEventListener('wheel', event => {
  if (event.ctrlKey || document.querySelector('#modal').open || !event.target.closest('.featured-project') || event.target.closest('video')) return;
  const count = featuredCount();
  if (count < 2) return;
  const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!rawDelta) return;
  const delta = rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  const now = performance.now();
  if (now < slideLockedUntil) { event.preventDefault(); return; }
  const direction = Math.sign(delta);
  const current = featuredIndex % count;
  if ((direction < 0 && current === 0) || (direction > 0 && current === count - 1)) { wheelDistance = 0; return; }
  event.preventDefault();
  if (now - lastWheelAt > 180 || Math.sign(wheelDistance) !== direction) wheelDistance = 0;
  lastWheelAt = now;
  wheelDistance += delta;
  if (Math.abs(wheelDistance) < 60) return;
  wheelDistance = 0;
  slideLockedUntil = now + 650;
  void changeFeatured(direction, false);
}, {passive:false});

// Horizontal swipes work on touchscreens; vertical swipes remain normal page scrolling.
document.addEventListener('touchstart', event => {
  swipeStart = null;
  if (event.touches.length !== 1 || !event.target.closest('.featured-project') || event.target.closest('button,a,video') || document.querySelector('#modal').open) return;
  const touch = event.touches[0];
  swipeStart = {x:touch.clientX, y:touch.clientY};
}, {passive:true});
document.addEventListener('touchend', event => {
  if (!swipeStart) return;
  const start = swipeStart;
  swipeStart = null;
  if (event.touches.length || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
  if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) void changeFeatured(dx < 0 ? 1 : -1, false);
}, {passive:true});
document.addEventListener('touchcancel', () => { swipeStart = null; }, {passive:true});

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,a');if(!target)return;
  if(savingProject){event.preventDefault();return;}
  if(target.classList.contains('skip-link')) { event.preventDefault(); document.querySelector('#main')?.focus(); return; }
  if(target.tagName==='A' && target.hash && target.hash!==location.hash && dirty) {
    event.preventDefault();if(savingProject)return;confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=target.hash;});return;
  }
  try {
    if(target.dataset.featureStep)await changeFeatured(Number(target.dataset.featureStep));
    if(target.dataset.filter){filter=target.dataset.filter;await render();document.querySelector('#collection').scrollIntoView({block:'start'});}
    if(target.dataset.projectTab){projectTab=target.dataset.projectTab;const y=scrollY;await render();scrollTo(0,y);document.querySelector(`[data-project-tab="${projectTab}"]`).focus({preventScroll:true});}
    if(target.dataset.aboutTab){aboutTab=target.dataset.aboutTab;const y=scrollY;await render();scrollTo(0,y);document.querySelector(`[data-about-tab="${aboutTab}"]`).focus({preventScroll:true});}
    if(target.dataset.mediaIndex!==undefined){mediaIndex=Number(target.dataset.mediaIndex);const y=scrollY;await render();scrollTo(0,y);}
    if(target.dataset.studioSection){if(dirty){confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=`/studio?section=${target.dataset.studioSection}`;});}else location.hash=`/studio?section=${target.dataset.studioSection}`;}
    if(target.dataset.download) await download(target.dataset.download,target.dataset.filename);
    if(target.dataset.removePending){pendingFiles=pendingFiles.filter(f=>f.id!==target.dataset.removePending);target.closest('[data-file-row]')?.remove();renderPending();dirty=true;}
    if(target.dataset.removeFile){removedFiles.add(target.dataset.removeFile);target.closest('[data-file-row]').remove();syncGalleryControls();dirty=true;}
    if(target.dataset.reorder){const row=target.closest('[data-file-row]');const sibling=Number(target.dataset.direction)<0?row.previousElementSibling:row.nextElementSibling;if(sibling){Number(target.dataset.direction)<0?sibling.before(row):sibling.after(row);dirty=true;syncGalleryControls();}}
    const action=target.dataset.action;
    if (action === 'signout') {
      if (savingProfile) return;
      target.disabled = true;
      try {
        await signOut();
        account = null;
        state = repository.reset();
        ownerShowroomId = null;
        dirty = false;
        workspaceError = '';
        workspaceLoadedFor = null;
        if (route().page === 'feed') syncFeedAccount();
        else location.hash = '/feed';
      } finally {
        target.disabled = false;
      }
      return;
    }
    if(action==='collection')document.querySelector('#collection')?.scrollIntoView({behavior:'smooth'});
    if(action==='view-gallery')document.querySelector('.project-stage')?.scrollIntoView({behavior:'smooth',block:'center'});
    if(action==='reset-filter'){filter='all';await render();document.querySelector('#collection').scrollIntoView();}
    if(action==='toggle-password'){const input=document.querySelector('#password');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'Hide':'Show';target.setAttribute('aria-pressed',String(show));}
    if (action === 'delete-project') {
      const current = state.projects.find(project => project.id === route().id);
      if (!current?.etag) return;
      confirmAction('Delete project?', `“${e(current.title)}” and its files will be permanently removed.`, 'Delete project', async () => {
        if (savingProject) return;
        savingProject = true;
        try {
          await deleteProject(current);
          state.projects = state.projects.filter(project => project.id !== current.id);
          editorLoad = undefined;
          dirty = false;
          notify('Project deleted.');
          location.hash = '/studio';
        } finally { savingProject = false; }
      });
    }
    if (action === 'reload-feed') await render();
    if (action === 'reload-showroom') { visitorLoad = undefined; await render(); }
    if (action === 'reload-project') { editorLoad = undefined; await render(); }
    if(action==='add-project')location.hash='/studio';
    if(action==='reload-profile'){await loadProfile();await render();}
    if(action==='reload-projects'){await loadWorkspace();await render();}
    if (action === 'terms') {
      modal('Using Folio', '<p>Use your account to manage your projects and publish them in your showroom. Visitors can view your published projects, saved profile information, and any CV you upload.</p>');
    }
    if(action==='privacy')modal('Your privacy','<p>Projects and their files are saved to your account. Saved profile fields and CVs are publicly visible. Default download preferences remain temporary previews. A session cookie keeps you signed in across reloads.</p>');
    if(target.closest('#modal') && target.tagName==='A')document.querySelector('#modal').close();
  }catch(error){notify(error.message||'Something went wrong. Please try again.');}
});
document.addEventListener('keydown',event=>{
  if (event.target.matches('.featured-project') && ['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key)) {
    event.preventDefault(); void changeFeatured(['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1); return;
  }
  const tab=event.target.closest('[role=tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const tabs=Array.from(tab.parentElement.querySelectorAll('[role=tab]'));const current=tabs.indexOf(tab);const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[index].click();
});
let previousHash=location.hash;
window.addEventListener('hashchange',async()=>{
  if(savingProject || savingProfile){history.replaceState(null,'',previousHash);return;}
  if(dirty){const nextHash=location.hash;history.replaceState(null,'',previousHash||'#/');confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=nextHash;});return;}
  aboutLoad = undefined;
  editorLoad = undefined;
  visitorLoad = undefined;
  if (route().showroomId) { featuredIndex = 0; filter = 'all'; }
  previousHash=location.hash;projectTab='specs';mediaIndex=0;await render();window.scrollTo(0,0);document.querySelector('#main').focus({preventScroll:true});
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
app.innerHTML='<main class="initial-loading"><span class="wordmark">folio</span><div class="loading-bar"></div><p>Making room for your work…</p></main>';
const restoration = restoreSession().then(account => ({ account }), error => ({ error }));
// Public feed loading and session restoration progress independently.
const initialFeed = route().page === 'feed';
if (initialFeed) await render();
try {
  const restored = await restoration;
  if (restored.error) throw restored.error;
  account = restored.account;
} catch {
  notify('Could not restore your session. You can still browse public projects.');
}
if (initialFeed && route().page === 'feed') syncFeedAccount();
else await render();
