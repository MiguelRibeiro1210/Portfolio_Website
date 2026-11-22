import { repository, emptyWorkspace, authenticate, registerAccount } from './api.js';
import { showroom, projectPage, studio } from './project.js';
import { aboutPage } from './cv.js';
import { authPage } from './auth.js';
import { escapeHTML as e, icon, link, button, notify, modal, confirmAction } from './ui.js';

let state = emptyWorkspace();
let featuredIndex = 0;
let filter = 'all', projectTab = 'specs', aboutTab = 'about', mediaIndex = 0;
let pendingFiles = [], removedFiles = new Set(), dirty = false, activeUrls = [];
const app = document.querySelector('#app');
// A fresh visit starts at sign-in; explicit gallery and project links still work.
if (!location.hash || location.hash === '#') history.replaceState(null, '', `${location.pathname}${location.search}#/signin`);
let wheelDistance = 0, lastWheelAt = 0, slideLockedUntil = 0;
let swipeStart = null;
function route() {
  const [path,query=''] = (location.hash.slice(1)||'/').split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0]||'home', id: parts[1], section: new URLSearchParams(query).get('section')||'projects' };
}
function header(page) {
  const home=page==='home', auth=['signin','register','reset'].includes(page), editor=page==='studio';
  const editingProject=editor && route().section==='projects';
  const project=state.projects.find(p=>p.id===route().id);
  return `<header class="site-header"><nav class="nav-left" aria-label="Main navigation"><a class="nav-link" href="#/">${home?'':icon('back',14)}Projects</a>${!auth && !editor ? '<a class="nav-link" href="#/about">About <span class="nav-optional">& CV</span></a>' : ''}</nav><a class="wordmark" href="#/" aria-label="folio home">folio</a><div class="nav-right">${editor ? `${link('Preview','#/','','external')}${editingProject?'<button type="submit" form="project-form" class="btn primary header-save">Save changes</button>':''}` : page==='project' ? `<span class="owner-label">Preview</span>${link('Edit project',project?`#/studio/${project.id}`:'#/studio','nav-edit')}` : page==='about' ? `${state.profile.cvId?button('Download CV','download-cv','nav-cv','download'):''}${link('Edit CV','#/studio?section=profile','nav-edit')}` : auth ? '' : home ? `<span class="owner-label">Your collection</span>${link('Add project','#/studio','nav-workspace','plus')}` : '<span class="nav-tagline">A thoughtful experience, in every state.</span>'}</div></header>`;
}
function footer() {
  const p=state.profile;
  return `<footer class="site-footer"><a class="wordmark" href="#/">folio<span>®</span></a><span>© ${new Date().getFullYear()}${p.name?' '+e(p.name):' · Your space. Your work.'}</span><div>${p.github?`<a href="${e(p.github)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`:''}${p.linkedin?`<a href="${e(p.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>`:''}${p.email?`<a href="mailto:${e(p.email)}">Say hello ↗</a>`:'<a href="#/studio?section=profile">Add contact details ↗</a>'}<a href="#/states">System states</a></div></footer>`;
}
function stateCard(kind) {
  const info = { loading: ['01 / LOADING','Curating exhibition data...','Your collection is being prepared.','Preview loading','preview-loading'], maintenance: ['02 / TEMPORARILY UNAVAILABLE','Gallery Room under maintenance','This gallery room is taking a short break. Try opening it again.','Try again','retry'], empty: ['03 / FIRST VISIT','Blank gallery wall','Every collection begins with one piece. Give your first project a home.','Add your first project','add-project'] }[kind];
  return `<section class="state-column"><p class="eyebrow">${info[0]}</p><div class="state-card ${kind}"><div class="state-illustration" aria-hidden="true">${kind==='loading'?'<div class="skeleton s-title"></div><div class="skeleton s-sub"></div><div class="skeleton s-art"></div><div class="skeleton s-text"></div>':`<div class="gallery-wall"><div class="wall-frame">${kind==='maintenance'?'<div class="wall-tape"></div><span>ROOM 503</span>':'<span>+</span>'}</div><span class="wall-floor"></span></div>`}</div><h2>${info[1]}</h2><p>${info[2]}</p>${button(info[3],info[4],kind==='empty'?'primary':'',kind==='empty'?'plus':'refresh')}</div></section>`;
}
function statesPage() {
  return `<section class="states-page section-pad"><p class="eyebrow">THE IN-BETWEEN MATTERS, TOO</p><h1>Even the pauses, considered<span class="blue-dot">.</span></h1><p>Quiet loading. Clear recovery. An invitation to begin.</p><div class="states-grid">${['loading','maintenance','empty'].map(stateCard).join('')}</div><div class="state-footnote"><span>Quiet loading. Clear recovery. An invitation to begin.</span><span>FOLIO / EXPERIENCE STATES</span></div></section>`;
}
async function render() {
  activeUrls.forEach(URL.revokeObjectURL); activeUrls=[];
  const r=route();
  document.body.dataset.page=r.page;
  const content = r.page==='home'?showroom(state,filter,featuredIndex):r.page==='project'?projectPage(state,r.id,projectTab,mediaIndex):r.page==='about'?aboutPage(state,aboutTab):r.page==='studio'?studio(state,r.id,r.section):['signin','register','reset'].includes(r.page)?authPage(r.page):r.page==='states'?statesPage():`<section class="not-found section-pad"><p class="eyebrow">404 / A LITTLE OFF THE MAP</p><h1>Let’s head back to the gallery.</h1>${link('Explore the projects','#/','primary','arrow')}</section>`;
  app.innerHTML = `${header(r.page)}<main id="main" tabindex="-1">${content}</main>${footer()}`;
  document.title=`${({home:'The collection',project:'Project experience',about:'Behind the projects',studio:'Your workspace',signin:'Sign in',register:'Create your gallery',reset:'Reset password',states:'The experience'})[r.page]||'Page not found'} — folio`;
  dirty=false; pendingFiles=[]; removedFiles.clear();
  bindForms();
  for (const container of app.querySelectorAll('[data-media-id]')) {
    try {
      const file = await repository.file(container.dataset.mediaId);
      if (!container.isConnected) break;
      if (!file) { container.textContent='This preview file is unavailable. Add it again in the editor.'; continue; }
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
    projectForm.onchange=()=>{dirty=true;}; projectForm.oninput=()=>{dirty=true;};
    for (const type of ['media','builds']) {
      const input=document.querySelector(type==='media'?'#media-input':'#build-input');
      input.onchange=()=>{
        const rejected=[];
        for(const file of input.files) {
          if(file.size>(type==='media'?20:100)*1024*1024) {rejected.push(`${file.name}: file is too large`); continue;}
          if(type==='media' && !['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(file.type)) {rejected.push(`${file.name}: unsupported media type`);continue;}
          if(type==='builds' && !/\.(zip|exe|apk|dmg|deb|appimage|msi|tar|gz)$/i.test(file.name)) {rejected.push(`${file.name}: unsupported release file`);continue;}
          pendingFiles.push({id:crypto.randomUUID(),file,category:type});
        }
        dirty=true; input.value=''; renderPending(); if(rejected.length) notify(rejected.join('. '));
      };
    }
  }
  const profileForm=document.querySelector('#profile-form');
  if(profileForm) {
    profileForm.oninput=()=>{dirty=true;}; profileForm.onchange=()=>{dirty=true;};
    profileForm.onsubmit=async event=>{
      event.preventDefault(); const submit=event.submitter; submit.disabled=true;
      try {
        const form = new FormData(profileForm); const next=structuredClone(state); const files=[]; const remove=[];
        for(const key of ['name','role','location','summary','experience','education','skills','email','github','linkedin']) next.profile[key]=String(form.get(key)||'').trim();
        for(const key of ['github','linkedin']) if(next.profile[key] && !safeUrl(next.profile[key])) throw new Error('Social links must use https:// or http://.');
        const cv=form.get('cv');
        if(cv?.size) {
          if(cv.type!=='application/pdf' || cv.size>10*1024*1024) throw new Error('Choose a PDF up to 10 MB.');
          if(next.profile.cvId) remove.push(next.profile.cvId);
          next.profile.cvId=crypto.randomUUID();next.profile.cvName=cv.name;files.push({id:next.profile.cvId,file:cv});
        }
        if(form.get('removeCv')) {if(next.profile.cvId)remove.push(next.profile.cvId);next.profile.cvId='';next.profile.cvName='';files.length=0;}
        await updatePreview(next,files,remove);notify('Profile updated for this preview.');await render();
      }catch(error){notify(error.message);}finally{submit.disabled=false;}
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

    const result = await authenticate();
    feedback.textContent = authForm.dataset.mode === 'reset'
      ? 'No email was sent. Password reset will be available when authentication is connected.'
      : result.message;
    if (password) password.value = '';
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
  event.preventDefault();const submit=event.submitter;submit.disabled=true;
  try {
    const r=route();const old=state.projects.find(p=>p.id===r.id);const form=new FormData(event.target);
    const p={id:old?.id||crypto.randomUUID(),title:String(form.get('title')||'').trim(),type:form.get('type'),description:String(form.get('description')||'').trim(),story:String(form.get('story')||'').trim(),stack:String(form.get('stack')||'').trim(),compatibility:String(form.get('compatibility')||'').trim(),source:String(form.get('source')||'').trim(),releaseNotes:String(form.get('releaseNotes')||'').trim(),permission:form.get('permission'),published:form.has('published'),media:(old?.media||[]).filter(m=>!removedFiles.has(m.id)),builds:(old?.builds||[]).filter(b=>!removedFiles.has(b.id))};
    if(!p.title)throw new Error('Give your project a title first.');
    if(p.source && !safeUrl(p.source))throw new Error('Use an http:// or https:// repository URL.');
    // Read staged order from the DOM so moving a file never discards unsaved fields.
    p.media.sort((a,b)=>Array.from(document.querySelectorAll('[data-file-row]')).findIndex(n=>n.dataset.fileRow===a.id)-Array.from(document.querySelectorAll('[data-file-row]')).findIndex(n=>n.dataset.fileRow===b.id));
    for(const item of pendingFiles)p[item.category].push({id:item.id,name:item.file.name,type:item.file.type,size:item.file.size});
    const next=structuredClone(state);const index=next.projects.findIndex(item=>item.id===p.id);if(index<0)next.projects.push(p);else next.projects[index]=p;
    await updatePreview(next,pendingFiles,[...removedFiles]);notify('Project updated for this preview.');
    if(r.id!==p.id)location.hash=`/studio/${p.id}`;else await render();
  }catch(error){notify(error.message);}finally{submit.disabled=false;}
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
  if(target.classList.contains('skip-link')) { event.preventDefault(); document.querySelector('#main')?.focus(); return; }
  if(target.tagName==='A' && target.hash && target.hash!==location.hash && dirty) {
    event.preventDefault();confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=target.hash;});return;
  }
  try {
    if(target.dataset.featureStep)await changeFeatured(Number(target.dataset.featureStep));
    if(target.dataset.filter){filter=target.dataset.filter;await render();document.querySelector('#collection').scrollIntoView({block:'start'});}
    if(target.dataset.projectTab){projectTab=target.dataset.projectTab;const y=scrollY;await render();scrollTo(0,y);document.querySelector(`[data-project-tab="${projectTab}"]`).focus({preventScroll:true});}
    if(target.dataset.aboutTab){aboutTab=target.dataset.aboutTab;const y=scrollY;await render();scrollTo(0,y);document.querySelector(`[data-about-tab="${aboutTab}"]`).focus({preventScroll:true});}
    if(target.dataset.mediaIndex!==undefined){mediaIndex=Number(target.dataset.mediaIndex);const y=scrollY;await render();scrollTo(0,y);const art=document.querySelector('.project-stage .mockup');if(art)art.dataset.view=mediaIndex;}
    if(target.dataset.studioSection){if(dirty){confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=`/studio?section=${target.dataset.studioSection}`;});}else location.hash=`/studio?section=${target.dataset.studioSection}`;}
    if(target.dataset.download){const p=state.projects.find(p=>p.id===route().id);if(route().page==='project' && p?.permission!=='public')modal('Release access',`<p>${p.permission==='none'?'Downloads are disabled for this project.':'This project needs approval to download. Access requests will be available when the backend is connected.'}</p>${link('Open project editor',`#/studio/${p.id}`,'primary','external')}`);else await download(target.dataset.download,target.dataset.filename);}
    if(target.dataset.removePending){pendingFiles=pendingFiles.filter(f=>f.id!==target.dataset.removePending);renderPending();dirty=true;}
    if(target.dataset.removeFile){removedFiles.add(target.dataset.removeFile);target.closest('[data-file-row]').remove();dirty=true;}
    if(target.dataset.reorder){const row=target.closest('[data-file-row]');const sibling=Number(target.dataset.direction)<0?row.previousElementSibling:row.nextElementSibling;if(sibling){Number(target.dataset.direction)<0?sibling.before(row):sibling.after(row);dirty=true;const rows=Array.from(row.parentElement.children);rows.forEach((el,i)=>{el.querySelector('[data-direction="-1"]').disabled=i===0;el.querySelector('[data-direction="1"]').disabled=i===rows.length-1;});}}
    const action=target.dataset.action;
    if(action==='collection')document.querySelector('#collection')?.scrollIntoView({behavior:'smooth'});
    if(action==='view-gallery')document.querySelector('.project-stage')?.scrollIntoView({behavior:'smooth',block:'center'});
    if(action==='reset-filter'){filter='all';await render();document.querySelector('#collection').scrollIntoView();}
    if(action==='toggle-password'){const input=document.querySelector('#password');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'Hide':'Show';target.setAttribute('aria-pressed',String(show));}
    if(action==='github')modal('Connect your account',`<p>GitHub sign-in is ready for your authentication provider. No account connection has been made.</p>${link('Explore the studio preview','#/studio','primary','arrow')}`);
    if(action==='download-cv'){if(state.profile.cvId)await download(state.profile.cvId,state.profile.cvName);else notify('Add a PDF in Profile & CV first.');}
    if(action==='delete-project'){const p=state.projects.find(p=>p.id===route().id);if(p)confirmAction('Delete this project?',`“${e(p.title)}” and its temporary files will be removed.`, 'Delete project',async()=>{const next=structuredClone(state);next.projects=next.projects.filter(item=>item.id!==p.id);await updatePreview(next,[],[...(p.media||[]),...(p.builds||[])].map(f=>f.id));location.hash='/studio';notify('Project deleted.');});}
    if(action==='add-project')location.hash='/studio';
    if(action==='retry'){notify('Gallery is ready.');location.hash='/';}
    if(action==='preview-loading'){modal('Curating your collection',`<div class="loading-preview"><div class="loading-bar"></div><p role="status">Preparing your gallery…</p></div>`);setTimeout(()=>{document.querySelector('#modal').close();notify('Your gallery is ready.');},1600);}
    if(action==='terms')modal('Terms of use','<p>This portfolio currently runs as a frontend preview. Service terms will appear here before online accounts and publishing become available.</p>');
    if(action==='privacy')modal('Your privacy','<p>Preview changes and selected files are held temporarily in memory and disappear when you reload or close the page. Nothing is written to browser storage. Credentials are never saved. Account and database connections are pending.</p>');
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
  if(dirty){const nextHash=location.hash;history.replaceState(null,'',previousHash||'#/');confirmAction('Leave without saving?','Your unsaved edits will be discarded.','Leave page',()=>{dirty=false;location.hash=nextHash;});return;}
  previousHash=location.hash;projectTab='specs';mediaIndex=0;await render();window.scrollTo(0,0);document.querySelector('#main').focus({preventScroll:true});
});
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
app.innerHTML='<main class="initial-loading"><span class="wordmark">folio</span><div class="loading-bar"></div><p>Making room for your work…</p></main>';
state=await repository.load();
await render();
