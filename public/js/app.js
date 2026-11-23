import { repository, emptyWorkspace, registerAccount, signIn, restoreSession, signOut, createProject, loadOwnerProfile, saveOwnerProfile, loadPublicProfile, publicCvUrl } from './api.js';
import { showroom, projectPage, studio } from './project.js';
import { aboutPage } from './cv.js';
import { authPage } from './auth.js';
import { escapeHTML as e, icon, link, button, notify, modal, confirmAction } from './ui.js';

let state = emptyWorkspace();
let account = null;
let featuredIndex = 0;
let savingProject = false, savingProfile = false, workspaceError = '', profileError = '';
let aboutLoad;
async function loadProfile() {
  profileError = '';
  try { state.profile = await loadOwnerProfile(); }
  catch (error) { profileError = error.message; }
}

async function loadWorkspace() {
  try { state = await repository.load(); workspaceError = ''; }
  catch (error) { workspaceError = error.message; }
}
let filter = 'all', projectTab = 'specs', aboutTab = 'about', mediaIndex = 0;
let pendingFiles = [], removedFiles = new Set(), dirty = false, activeUrls = [];
window.addEventListener('session-ended', () => { account = null; });
const app = document.querySelector('#app');
// A fresh visit starts at sign-in; explicit gallery and project links still work.
if (!location.hash || location.hash === '#') history.replaceState(null, '', `${location.pathname}${location.search}#/signin`);
let wheelDistance = 0, lastWheelAt = 0, slideLockedUntil = 0;
let swipeStart = null;
function route() {
  const [path,query=''] = (location.hash.slice(1)||'/').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  return { page: parts[0] || 'home', id: parts[1], section: params.get('section') || 'projects', oauth: params.get('oauth') };
}
function header(page, profile = state.profile, ownProfile = true) {
  const home=page==='home', auth=['signin','register','reset'].includes(page), editor=page==='studio';
  const accountAction = account
    ? '<button type="button" class="text-btn nav-account" data-action="signout">Sign out</button>'
    : auth ? '' : '<a class="nav-link nav-account" href="#/signin">Sign in</a>';
  const editingProject=editor && route().section==='projects' && !route().id && account;
  const project=state.projects.find(p=>p.id===route().id);
  return `<header class="site-header"><nav class="nav-left" aria-label="Main navigation"><a class="nav-link" href="#/">${home?'':icon('back',14)}Projects</a>${!auth && !editor ? '<a class="nav-link" href="#/about">About <span class="nav-optional">& CV</span></a>' : ''}</nav><a class="wordmark" href="#/" aria-label="folio home">folio</a><div class="nav-right">${editor ? `${link('Preview','#/','','external')}${editingProject?'<button type="submit" form="project-form" class="btn primary header-save">Save changes</button>':''}` : page==='project' ? `<span class="owner-label">Preview</span>${link('Edit project',project?`#/studio/${project.id}`:'#/studio','nav-edit')}` : page==='about' ? `${profile.cvId?link('Download CV',publicCvUrl(profile.cvId,true),'nav-cv','download'):''}${account && ownProfile ? link('Edit CV','#/studio?section=profile','nav-edit') : ''}` : auth ? '' : home ? `<span class="owner-label">Your collection</span>${link('Add project','#/studio','nav-workspace','plus')}` : '<span class="nav-tagline">A thoughtful experience, in every state.</span>'}${accountAction}</div></header>`;
}
function footer(p = state.profile, showEditor = true) {
  return `<footer class="site-footer"><a class="wordmark" href="#/">folio<span>®</span></a><span>© ${new Date().getFullYear()}${p.name?' '+e(p.name):' · Your space. Your work.'}</span><div>${p.github?`<a href="${e(p.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`:''}${p.linkedin?`<a href="${e(p.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>`:''}${p.email?`<a href="mailto:${e(p.email)}">Say hello ↗</a>`:showEditor?'<a href="#/studio?section=profile">Add contact details ↗</a>':''}<a href="#/states">System states</a></div></footer>`;
}
function stateCard(kind) {
  const info = { loading: ['01 / LOADING','Curating exhibition data...','Your collection is being prepared.','Preview loading','preview-loading'], maintenance: ['02 / TEMPORARILY UNAVAILABLE','Gallery Room under maintenance','This gallery room is taking a short break. Try opening it again.','Try again','retry'], empty: ['03 / FIRST VISIT','Blank gallery wall','Every collection begins with one piece. Give your first project a home.','Add your first project','add-project'] }[kind];
  return `<section class="state-column"><p class="eyebrow">${info[0]}</p><div class="state-card ${kind}"><div class="state-illustration" aria-hidden="true">${kind==='loading'?'<div class="skeleton s-title"></div><div class="skeleton s-sub"></div><div class="skeleton s-art"></div><div class="skeleton s-text"></div>':`<div class="gallery-wall"><div class="wall-frame">${kind==='maintenance'?'<div class="wall-tape"></div><span>ROOM 503</span>':'<span>+</span>'}</div><span class="wall-floor"></span></div>`}</div><h2>${info[1]}</h2><p>${info[2]}</p>${button(info[3],info[4],kind==='empty'?'primary':'',kind==='empty'?'plus':'refresh')}</div></section>`;
}
function statesPage() {
  return `<section class="states-page section-pad"><p class="eyebrow">THE IN-BETWEEN MATTERS, TOO</p><h1>Even the pauses, considered<span class="blue-dot">.</span></h1><p>Quiet loading. Clear recovery. An invitation to begin.</p><div class="states-grid">${['loading','maintenance','empty'].map(stateCard).join('')}</div><div class="state-footnote"><span>Quiet loading. Clear recovery. An invitation to begin.</span><span>FOLIO / EXPERIENCE STATES</span></div></section>`;
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
  activeUrls.forEach(URL.revokeObjectURL); activeUrls=[];
  if (account && route().page === 'signin' && !route().oauth) {
    history.replaceState(null, '', '#/');
    previousHash = location.hash;
  }
  const r=route();
  const renderedHash = location.hash;
  let profile = state.profile;
  let missingProfile = false;
  const ownProfile = Boolean(account && (!r.id || r.id === state.profile.publicId));
  if (r.page === 'about' && r.id) {
    if (aboutLoad?.id !== r.id) aboutLoad = { id: r.id, result: loadPublicProfile(r.id) };
    try {
      const saved = await aboutLoad.result;
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
  const content = r.page==='home'?showroom(state,filter,featuredIndex):r.page==='project'?projectPage(state,r.id,projectTab,mediaIndex):r.page==='about'?(missingProfile ? '<section class="section-pad"><h1>Profile not found.</h1></section>'
    : aboutPage({ profile }, aboutTab, ownProfile)):r.page==='studio'?studio(state,r.id,r.section,account,oauthStatus,profileError):['signin','register','reset'].includes(r.page)?authPage(r.page,oauthStatus):r.page==='states'?statesPage():`<section class="not-found section-pad"><p class="eyebrow">404 / A LITTLE OFF THE MAP</p><h1>Let’s head back to the gallery.</h1>${link('Explore the projects','#/','primary','arrow')}</section>`;
  app.innerHTML = `${header(r.page, profile, ownProfile)}<main id="main" tabindex="-1">${workspaceError ? `<div class="section-pad" role="alert"><p>${e(workspaceError)}</p>${button('Retry loading projects','reload-projects')}</div>` : ''}${content}</main>${footer(profile, r.page !== 'about' || ownProfile)}`;
  document.title=`${({home:'The collection',project:'Project experience',about:'Behind the projects',studio:'Your workspace',signin:'Sign in',register:'Create your gallery',reset:'Reset password',states:'The experience'})[r.page]||'Page not found'} — folio`;
  dirty=false; pendingFiles=[]; removedFiles.clear();
  bindForms();
  for (const container of app.querySelectorAll('[data-media-id]')) {
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
    if (route().id) {
      projectForm.querySelectorAll('input,textarea,select,button').forEach(control => { if (!control.dataset.download) control.disabled = true; });
      return;
    }
    if (!account) {
      projectForm.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
    }
    projectForm.onchange=()=>{dirty=true;}; projectForm.oninput=()=>{dirty=true;};
    for (const type of ['media','builds']) {
      const input=document.querySelector(type==='media'?'#media-input':'#build-input');
      input.onchange=()=>{
        const rejected=[];
        for(const file of input.files) {
          if(file.size>(type==='media'?20:100)*1024*1024) {rejected.push(`${file.name}: file is too large`); continue;}
          if(type==='media' && !['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(file.type)) {rejected.push(`${file.name}: unsupported media type`);continue;}
          if(type==='builds' && !/\.(zip|exe|apk|dmg|deb|appimage|msi|tar|gz)$/i.test(file.name)) {rejected.push(`${file.name}: unsupported release file`);continue;}
          if (type==='builds' && pendingFiles.some(item=>item.category==='builds')) { rejected.push('Select at most one build. Remove the current selection first.'); continue; }
          if (type==='media' && pendingFiles.filter(item=>item.category==='media').length >= 10) { rejected.push('Select at most 10 gallery files.'); continue; }
          pendingFiles.push({id:crypto.randomUUID(),file,category:type});
        }
        dirty=true; input.value=''; renderPending(); if(rejected.length) notify(rejected.join('. '));
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
      await loadWorkspace();
      await loadProfile();
      if (route().page === 'signin') location.hash = '/';
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
  if (!account) { notify('Sign in before creating a project.'); return; }
  if (route().id) { notify('Editing saved projects is not available yet.'); return; }
  const formElement = event.target;
  const buttons = [...document.querySelectorAll('button[type="submit"][form="project-form"], #project-form button[type="submit"]')];
  savingProject = true;
  formElement.inert = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    const form = new FormData(formElement);
    const p = Object.fromEntries(['title','type','description','stack','story','compatibility','source','releaseNotes','permission'].map(key=>[key,String(form.get(key)||'').trim()]));
    p.published = form.has('published');
    if (!p.title || !p.description || !p.stack) throw new Error('Fill in the title, description, and tech stack.');
    if (p.source && !safeUrl(p.source)) throw new Error('Use an HTTP or HTTPS repository URL.');
    if (!pendingFiles.some(item=>item.category==='media')) throw new Error('Add at least one gallery image or video.');
    const saved = await createProject(p, pendingFiles);
    state.projects.push(saved);
    dirty = false;
    notify('Project saved.');
    location.hash = `/studio/${saved.id}`;
  } catch (error) {
    notify(error.message || 'Could not save your project.');
  } finally {
    savingProject = false;
    formElement.inert = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

function renderPending(){for(const category of ['media','builds']){const list=document.querySelector(`#pending-${category}`);list.innerHTML=pendingFiles.filter(f=>f.category===category).map(item=>`<div class="file-row"><span>${icon('file',16)}${e(item.file.name)}</span><button type="button" class="icon-btn" data-remove-pending="${item.id}" aria-label="Remove ${e(item.file.name)}">${icon('close',16)}</button></div>`).join('');}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function download(id,name){const file=await repository.file(id);if(!file)throw new Error('This file is unavailable. Add it again in your workspace.');downloadBlob(file,name||file.name);}

async function changeFeatured(step, wrap = true) {
  const count = state.projects.filter(project => project.published).length;
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
  const count = state.projects.filter(project => project.published).length;
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
    if(target.dataset.mediaIndex!==undefined){mediaIndex=Number(target.dataset.mediaIndex);const y=scrollY;await render();scrollTo(0,y);const art=document.querySelector('.project-stage .mockup');if(art)art.dataset.view=mediaIndex;}
    if(target.dataset.studioSection){if(dirty){confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=`/studio?section=${target.dataset.studioSection}`;});}else location.hash=`/studio?section=${target.dataset.studioSection}`;}
    if(target.dataset.download) await download(target.dataset.download,target.dataset.filename);
    if(target.dataset.removePending){pendingFiles=pendingFiles.filter(f=>f.id!==target.dataset.removePending);renderPending();dirty=true;}
    if(target.dataset.removeFile){removedFiles.add(target.dataset.removeFile);target.closest('[data-file-row]').remove();dirty=true;}
    if(target.dataset.reorder){const row=target.closest('[data-file-row]');const sibling=Number(target.dataset.direction)<0?row.previousElementSibling:row.nextElementSibling;if(sibling){Number(target.dataset.direction)<0?sibling.before(row):sibling.after(row);dirty=true;const rows=Array.from(row.parentElement.children);rows.forEach((el,i)=>{el.querySelector('[data-direction="-1"]').disabled=i===0;el.querySelector('[data-direction="1"]').disabled=i===rows.length-1;});}}
    const action=target.dataset.action;
    if (action === 'signout') {
      if (savingProfile) return;
      target.disabled = true;
      try {
        await signOut();
        account = null;
        state = repository.reset();
        dirty = false;
        workspaceError = '';
        location.hash = '/signin';
      } finally {
        target.disabled = false;
      }
      return;
    }
    if(action==='collection')document.querySelector('#collection')?.scrollIntoView({behavior:'smooth'});
    if(action==='view-gallery')document.querySelector('.project-stage')?.scrollIntoView({behavior:'smooth',block:'center'});
    if(action==='reset-filter'){filter='all';await render();document.querySelector('#collection').scrollIntoView();}
    if(action==='toggle-password'){const input=document.querySelector('#password');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'Hide':'Show';target.setAttribute('aria-pressed',String(show));}
    if(action==='add-project')location.hash='/studio';
    if(action==='reload-profile'){await loadProfile();await render();}
    if(action==='reload-projects'){await loadWorkspace();await render();}
    if(action==='retry'){await loadWorkspace();location.hash='/';await render();}
    if(action==='preview-loading'){modal('Curating your collection',`<div class="loading-preview"><div class="loading-bar"></div><p role="status">Preparing your gallery…</p></div>`);setTimeout(()=>{document.querySelector('#modal').close();notify('Your gallery is ready.');},1600);}
    if(action==='terms')modal('Terms of use','<p>This portfolio currently runs as a frontend preview. Service terms will appear here before online accounts and publishing become available.</p>');
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
  previousHash=location.hash;projectTab='specs';mediaIndex=0;await render();window.scrollTo(0,0);document.querySelector('#main').focus({preventScroll:true});
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
app.innerHTML='<main class="initial-loading"><span class="wordmark">folio</span><div class="loading-bar"></div><p>Making room for your work…</p></main>';
try {
  account = await restoreSession();
  if (account) {
    await loadWorkspace();
    await loadProfile();
  }
} catch {
  notify('Could not restore your session. Please sign in again.');
}
await render();
