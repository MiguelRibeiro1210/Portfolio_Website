import { technologyEditor, technologyTags } from './tech-stack.js';
import { collaboratorEditor, projectCredits, collaborationList } from './collaborators.js';
import { publicCvUrl, showroomPath, showroomFileUrl } from './api.js';
import { escapeHTML as e, icon, link, button, placeholder, field, textarea } from './ui.js';

export function showroom(state, filter = 'all', featuredIndex = 0, visitor = null) {
  const projects = state.projects.filter(p => p.published);
  const heading = state.profile.name ? `${e(state.profile.name)}’s Projects` : visitor ? 'Project showroom' : 'Your Projects';
  if (!projects.length) {
    if (visitor) {
      return `<section class="collection section-pad"><h1>No published projects yet.</h1>
        ${visitor.profileId ? link('About & CV', `#/about/${encodeURIComponent(visitor.profileId)}?showroom=${encodeURIComponent(visitor.id)}`) : ''}</section>`;
    }
    return `<section class="collection section-pad">
      <div class="showroom-heading"><h1>${heading}</h1></div>
      <div class="empty-filter"><h2>No published projects yet.</h2>
        <p>Create a project or publish a draft from your studio.</p>
        ${link(state.projects.length ? 'Open project studio' : 'Create your first project', '#/studio', 'primary', 'external')}
      </div>
    </section>`;
  }
  const index = featuredIndex % projects.length;
  const featured = projects[index];
  const visible = projects.filter(p => filter === 'all' || p.type === filter);
  const count = projects.length;
  return `<section class="showroom-hero section-pad">
    <div class="showroom-heading"><p class="eyebrow">A curated collection</p><h1>${heading}</h1></div>
    <div class="featured-project" role="region" aria-roledescription="carousel" aria-label="Featured projects" tabindex="0"><div class="featured-copy"><p class="eyebrow">01 / Featured project</p><h2 aria-live="polite" aria-atomic="true">${e(featured.title)}</h2><p class="featured-description">${featured?.description ? e(featured.description) : placeholder('A short description of your project.')}</p><div class="featured-actions">${link('Explore project',projectPath(featured, visitor),'primary','external')}${featured?.source ? `<a class="btn" href="${e(featured.source)}" target="_blank" rel="noopener noreferrer">GitHub ${icon('external',14)}</a>` : visitor ? '' : link('Project studio','#/studio','','external')}</div><div class="featured-links">${featured?.stack ? technologyTags(featured.stack, 4) : placeholder('Technology stack')}</div></div>
    <div class="featured-preview">${featured?.media?.[0] ? `<div class="media-view" data-media-id="${e(featured.media[0].id)}"></div>` : dashboardPreview()}<p class="featured-caption">${e(featured.title)}</p>${projects.length>1 ? '<span class="slideshow-hint"><span class="scroll-hint">Scroll to explore projects</span><span class="swipe-hint">Swipe to explore projects</span></span>' : ''}</div>
    <div class="featured-controls" aria-label="Featured projects"><button type="button" class="icon-btn" data-feature-step="-1" aria-label="Previous featured project" ${projects.length<2?'disabled':''}>↑</button><span>${String(index+1).padStart(2,'0')}</span><div class="featured-track"><i style="--position:${index/count};--size:${1/count}"></i></div><span>${String(count).padStart(2,'0')}</span><button type="button" class="icon-btn" data-feature-step="1" aria-label="Next featured project" ${projects.length<2?'disabled':''}>↓</button></div></div>
    <div class="hero-bottom">${button('Explore the collection','collection','text-btn')}<span>${e(featured.title)}</span></div>
    </section>
    <section class="collection section-pad" id="collection"><div class="section-header"><div><h2>Built with love</h2></div><div class="filters" aria-label="Filter projects">${[['all','All works'],['open','Open-source'],['private','Private']].map(([value,label]) => `<button type="button" class="filter ${filter === value ? 'selected' : ''}" data-filter="${value}" aria-pressed="${filter === value}">${label}<span>${String(value === 'all' ? projects.length : projects.filter(p => p.type === value).length).padStart(2,'0')}</span></button>`).join('')}</div></div><div class="project-grid">${visible.length ? visible.map((p,i)=>projectCard(p,i,visitor)).join('') : `<div class="empty-filter">${icon('grid',32)}<h3>No ${filter==='open'?'open-source':filter==='private'?'private':'published'} projects yet.</h3><p>Projects in this collection will appear here.</p>${button('Show all works','reset-filter','','arrow')}</div>`}</div><div class="collection-footer"><span>${projects.length ? `Showing ${visible.length} of ${projects.length} selected works` : 'Your selected works will appear here'}</span>${visitor ? '' : link('View the full collection','#/studio','text-btn','external')}</div></section>
    ${!visitor ? `<section class="maker"><h2>Share a new project</h2>
      ${link('Submit a project','#/studio','','external')}</section>` : ''}`;
}
function projectPath(project, visitor) {
  const showroomId = visitor?.id ?? project?.sharedShowroomId;
  return showroomId ? showroomPath(showroomId, project.id) : `#/project/${project?.id || 'placeholder'}`;
}

export function projectCard(project,index,visitor) {
  return `<a class="project-card" href="${projectPath(project, visitor)}"><p class="eyebrow">${String(index+1).padStart(2,'0')} / ${project ? (project.type==='private'?'PRIVATE COLLECTION':'OPEN-SOURCE') : 'PROJECT PREVIEW'}</p><h3>${project ? e(project.title) : placeholder('Project title')}</h3><div class="project-visual ${index%2?'yellow':'blue'}">${project?.media?.[0] ? `<div class="media-view" data-media-id="${e(project.media[0].id)}"></div>` : dashboardPreview(true, index)}</div><p>${project?.description ? e(project.description) : placeholder('A short description of your project')}</p><div class="project-card-bottom"><div>${project?.stack ? technologyTags(project.stack, 4) : placeholder('Technology stack')}</div><span>Explore ${icon('external',13)}</span></div></a>`;
}
function dashboardPreview(compact = false, variant = 0) {
  const heights = [21, 31, 27, 35, 42, 33, 48, 56, 43, 39, 58, 53, 73, 63, 70, 61, 79, 73, 85, 77, 93, 84, 90, 95];
  if (compact) {
    const headings = ['A place for every idea.', 'Less setup. More shipping.', 'Everything, in sync.'];
    return `<div class="dashboard-preview compact-preview preview-${variant % 3}" aria-hidden="true">
      <p class="eyebrow">Project preview</p><strong>${headings[variant % 3]}</strong>
      <div class="preview-metrics"><span>Overview</span><span>Workspace</span><span>Activity</span></div></div>`;
  }
  return `<div class="dashboard-preview" aria-hidden="true">
    <div class="preview-nav"><strong>pulse</strong><span>Overview</span><span>Services</span><span>Incidents</span></div>
    <h3>System overview</h3><div class="preview-metrics">
      <div><small>Uptime</small><strong>99.98%</strong></div>
      <div><small>Avg. latency</small><strong>142 ms</strong></div>
      <div><small>Requests</small><strong>2.4m</strong></div>
    </div>
    <div class="preview-chart"><small>Request volume</small><div>${heights.map(height => `<i style="--bar-height:${height}%"></i>`).join('')}</div></div>
  </div>`;
}

export function projectPage(state, id, tab = 'specs', mediaIndex = 0, visitor = null) {
  const p = state.projects.find(p => p.id === id);
  if (!p) return `<section class="not-found section-pad"><p class="eyebrow">PROJECT NOT FOUND</p><h1>This room is empty.</h1><p>This project may have been removed.</p>${link('Back to the collection',visitor ? showroomPath(visitor.id) : '#/','primary','back')}</section>`;
  const media = p?.media || [];
  return `<article class="project-experience section-pad"><div class="project-breadcrumb">${link('Showroom', visitor ? showroomPath(visitor.id) : '#/', 'text-btn')} <span>/ ${p ? e(p.title) : 'Project'}</span></div><div class="project-title-row"><div><p class="eyebrow">${p ? (p.type === 'private' ? 'PRIVATE COLLECTION' : 'OPEN-SOURCE COLLECTION') : 'YOUR PROJECT / PREVIEW'}</p><h1>${p ? e(p.title) : placeholder('Project title')}</h1><p>${p?.description ? e(p.description) : placeholder('Your project’s short description will appear here.')}</p></div>${!visitor ? link('Edit project',p ? `#/studio/${p.id}` : '#/studio','', 'external') : ''}</div><div class="project-layout"><div class="project-main"><section class="project-hero"><div class="project-stage">${media.length ? `<div class="media-view" data-media-id="${e(media[mediaIndex % media.length].id)}" data-media-type="${e(media[mediaIndex % media.length].type)}"></div>` : dashboardPreview()}<span class="stage-note">${media.length ? e(media[mediaIndex % media.length].name) : 'PROJECT MEDIA PLACEHOLDER'}</span></div><div class="gallery-controls"><div class="gallery-thumbs">${(media.length ? media : [{name:'Workspace'},{name:'Canvas'},{name:'Inspector'},{name:'Export'}]).map((m,i) => `<button type="button" class="gallery-thumb ${i === mediaIndex ? 'selected' : ''}" data-media-index="${i}" aria-label="View ${e(m.name)}" aria-pressed="${i === mediaIndex}"><span class="mini-art mini-${i}"><i></i></span><span>${String(i+1).padStart(2,'0')} ${media.length ? e(m.name) : m.name}</span></button>`).join('')}</div><span class="gallery-count">${String(mediaIndex+1).padStart(2,'0')} / ${String(media.length || 4).padStart(2,'0')} <span>— Room for a closer look.</span></span></div></section>
    <section class="project-information"><div><p class="eyebrow">THE IDEA</p><h2>About this project</h2><p class="project-story">${p?.story ? e(p.story) : placeholder('Tell the story behind your project. What did you build, and why?')}</p><div class="tabs" role="tablist" aria-label="Project information">${[['media','Overview'],['specs','Technical details'],['releases','Release notes']].map(([v,l])=>`<button type="button" role="tab" id="tab-${v}" aria-controls="project-tabpanel" aria-selected="${tab===v}" tabindex="${tab===v ? 0 : -1}" data-project-tab="${v}" class="${tab===v?'active':''}">${l}</button>`).join('')}</div><div class="tab-content" id="project-tabpanel" role="tabpanel" aria-labelledby="tab-${tab}">${tab === 'specs' ? `<div class="spec-grid"><div><span>Built with</span>${p?.stack ? technologyTags(p.stack) : placeholder('Technology stack')}</div><div><span>Compatibility</span><p>${p?.compatibility ? e(p.compatibility) : placeholder('Supported platforms and requirements')}</p></div></div>` : tab === 'releases' ? `<h3>What’s new</h3><p class="preserve-lines">${p?.releaseNotes ? e(p.releaseNotes) : placeholder('Release notes will appear here.')}</p>` : `<h3>Inside the project</h3><p>${media.length ? `${media.length} files in the gallery. Select a thumbnail above to explore.` : placeholder('Add images or videos in the project studio.')}</p>${button('View gallery','view-gallery','text-btn','arrow')}`}</div></div></section>${projectCredits(p)}</div><aside class="downloads-panel"><div class="panel-icon">${icon(p?.type === 'open' ? 'code' : 'download',24)}</div><p class="eyebrow">Release files</p><h3>Downloads</h3><p>${p?.type === 'open' ? 'Explore the source, make it your own, and build on the idea.' : 'Release files and access details will live right here.'}</p>${visitor ? publicProjectLinks(p, visitor) : `${p?.type === 'open' && p.source ? `<a class="btn primary full" href="${e(p.source)}" target="_blank" rel="noopener noreferrer">View source ${icon('external')}</a>` : p?.builds?.length ? p.builds.map(b=>`<button type="button" class="btn primary full" data-download="${e(b.id)}" data-filename="${e(b.name)}">${e(b.name)} ${icon('download')}</button>`).join('') : `<div class="download-placeholder">${icon('file')}<span>${p?.type === 'open' ? 'Repository link placeholder' : 'No release files added yet'}</span></div>`}<span class="fine-print">${p?.builds?.length ? 'Saved release files.' : 'Ready when you are.'}</span>`}</aside></div></article>`;
}
function publicProjectLinks(project, viewer) {
  const { source, type, build, id } = project;
  const sourceLink = type === 'open' && source
    ? `<a class="btn primary full" href="${e(source)}" target="_blank" rel="noopener noreferrer">View source ${icon('external')}</a>` : '';
  if (build?.id) return sourceLink + link('Download build', showroomFileUrl(viewer.id, id, build.id), 'primary full', 'download');
  if (build?.permission === 'request' || build?.permission === 'none') return sourceLink + '<p>Downloads are disabled for this build.</p>';
  return sourceLink || '<p>No build is available to download.</p>';
}

function downloadPermissionOptions(permission) {
  const isPublic = permission === 'public';
  return `<option value="none"${isPublic ? '' : ' selected'}>Downloads disabled</option>
    <option value="public"${isPublic ? ' selected' : ''}>All visitors</option>`;
}

export function studio(state, id, section = 'projects', account = null, oauthStatus = '', profileError = '', ownerShowroomId = null, collaborations = []) {
  const p = state.projects.find(p => p.id === id) || {};
  return `<div class="studio-layout"><aside class="studio-sidebar"><div><p class="eyebrow">YOUR SPACE</p>${[['projects','Projects',state.projects.length],['profile','Profile & CV',''],['security','Access & security','']].map(([v,l,n])=>`<button type="button" data-studio-section="${v}" class="sidebar-link ${v===section?'active':''}">${l}<span>${n}</span></button>`).join('')}</div><div class="sidebar-bottom"><p class="eyebrow">THE CURATOR</p><h3>${state.profile.name ? e(state.profile.name) : 'Your workspace.'}</h3><p>Your portfolio workspace</p></div></aside><div class="studio-main">${section === 'profile' ? profileEditor(state, account, profileError, ownerShowroomId) : section === 'security' ? securityEditor(state, account, oauthStatus) : `<div class="studio-title"><div><p class="eyebrow">${p.id ? 'PROJECT / EDITING' : 'YOUR COLLECTION / STUDIO'}</p><h1>Project studio</h1><p>Manage your saved projects and their files.</p></div>${p.id ? link('New project','#/studio','','plus') : ''}</div><div class="draft-list">${state.projects.map(item=>`<a class="draft-chip ${item.id===id?'active':''}" href="#/studio/${item.id}">${e(item.title)}<span>${item.published?'In collection':'Draft'}</span></a>`).join('')}</div>${collaborationList(collaborations, ownerShowroomId)}<p role="status">${p.id ? '' : account ? '' : 'Sign in to save a project.'}</p>${!account ? link('Sign in','#/signin','primary') : ''}<form id="project-form"><div class="editor-grid"><section class="editor-panel"><h2><span>01 /</span> Project details</h2>${field('Project title','title',p.title,'Give your project a name','text',true)}<fieldset><legend>Showcase type</legend><div class="radio-cards"><label><input type="radio" name="type" value="open" ${p.type!=='private'?'checked':''}> Open-source</label><label><input type="radio" name="type" value="private" ${p.type==='private'?'checked':''}> Private / closed-source</label></div></fieldset>${textarea('Short description','description',p.description,'A sentence that captures the idea.',2).replace('<textarea ', '<textarea required maxlength="5000" ')}${technologyEditor(p.stack)}<label class="field"><span>Media gallery</span><span class="upload-zone">${icon('plus')}<strong>Add images or video</strong><span>PNG, JPG, WebP, GIF, MP4, WebM · up to 20 MB each</span><input id="media-input" type="file" name="media" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple></span></label><div id="pending-media" class="file-list" aria-live="polite">${(p.media||[]).map((m,i)=>`<div class="file-row" data-file-row="${e(m.id)}"><span>${icon('file',16)}${e(m.name)}</span><div><button type="button" class="icon-btn" data-reorder="${e(m.id)}" data-direction="-1" aria-label="Move ${e(m.name)} earlier" ${i===0?'disabled':''}>↑</button><button type="button" class="icon-btn" data-reorder="${e(m.id)}" data-direction="1" aria-label="Move ${e(m.name)} later" ${i===(p.media||[]).length-1?'disabled':''}>↓</button><button type="button" class="icon-btn" data-remove-file="${e(m.id)}" aria-label="Remove ${e(m.name)}">${icon('close',16)}</button></div></div>`).join('')}</div><details class="more-details"><summary>Story, compatibility & release notes</summary>${textarea('The idea','story',p.story,'The thinking behind the work.',4)}${field('Compatibility','compatibility',p.compatibility,'Platforms and system requirements')}${field('Source repository','source',p.source,'https://github.com/…','url')}${textarea('Release notes','releaseNotes',p.releaseNotes,'What changed in this release?',3)}</details></section><aside class="editor-aside"><section class="editor-panel"><h2><span>02 /</span> Builds & access</h2><label class="field"><span>Download permission</span><select name="permission">${downloadPermissionOptions(p.permission ?? state.settings.permission)}</select></label><p class="fine-print">Visitor download setting. You can always download your own build.</p><label class="field"><span>Release files</span><span class="upload-zone compact">${icon('download')}<strong>Upload a release</strong><span>ZIP, EXE, APK, DMG, DEB · up to 100 MB each</span><input type="file" id="build-input" name="build" accept=".zip,.exe,.apk,.dmg,.deb,.AppImage,.msi,.tar,.gz"></span></label><div id="pending-builds" class="file-list" aria-live="polite"></div>${(p.builds||[]).map(b=>`<div class="file-row" data-file-row="${e(b.id)}"><span>${e(b.name)}</span><button type="button" class="icon-btn" data-download="${e(b.id)}" data-filename="${e(b.name)}" aria-label="Download ${e(b.name)}">${icon('download',16)}</button><button type="button" class="icon-btn" data-remove-file="${e(b.id)}" aria-label="Remove ${e(b.name)}">${icon('close',16)}</button></div>`).join('')}</section><section class="editor-panel studio-cv"><h2>Your CV, in good hands.</h2><p>${state.profile.cvName ? e(state.profile.cvName) : placeholder('Your PDF résumé')}</p><div class="cv-controls">${link(state.profile.cvId?'Replace PDF':'Add PDF','#/studio?section=profile','','upload')}${state.profile.cvId ? link('Download',publicCvUrl(state.profile.cvId,true),'','download') : link('Manage CV','#/studio?section=profile')}</div><p class="fine-print">PDF · up to 10 MiB</p></section><section class="publish-card"><span class="eyebrow">READY FOR THE GALLERY?</span><h3>Good work deserves<br>to be seen.</h3><label class="checkbox"><input type="checkbox" name="published" ${p.id ? (p.published?'checked':'') : 'checked'}> Show in the collection</label><p>Save this project to your account. Select the checkbox to display it in your collection.</p></section><section class="editor-note">${icon('lock',17)}<p>${account ? 'Projects and files are saved to your account.' : 'Sign in to create and save a project.'}</p></section></aside></div>${collaboratorEditor(p, account, ownerShowroomId)}<div class="editor-footer">${p.id ? (p.ownerId === account?.id ? button('Delete project','delete-project','text-btn danger-text') : '') : '<span>Title, description, tech stack, and at least one gallery file are required.</span>'}${link('View collection','#/','text-btn','external')}<button type="submit" class="btn primary">Save changes ${icon('check')}</button></div></form>`}</div></div>`;
}
function profileEditor(state, account, error, ownerShowroomId) {
  const p = state.profile;
  if (!account || error) {
    return `<section class="studio-title"><div><h1>Behind the work.</h1>
      ${error ? `<p role="alert">${e(error)}</p>${button('Retry loading profile','reload-profile')}`
        : `<p>Sign in to edit your profile and CV.</p>${link('Sign in','#/signin','primary','arrow')}`}</div></section>`;
  }
  return `<div class="studio-title"><div><p class="eyebrow">PROFILE & CV</p><h1>Behind the work.</h1><p>Your story, in your own words.</p></div></div><form id="profile-form" class="profile-form"><section class="editor-panel"><h2><span>01 /</span> A little about you</h2><div class="form-grid">${field('Name','name',p.name,'Your name')}${field('Role','role',p.role,'What do you do?')}${field('Location','location',p.location,'City, country')}${field('Contact email','email',p.email,'you@example.com','email')}</div>${textarea('About','summary',p.summary,'A little about you and how you approach your work.',5)}${textarea('Experience','experience',p.experience,'Roles, organizations, dates, and contributions.',5)}${textarea('Education','education',p.education,'Qualifications, institutions, and dates.',4)}${textarea('Skills','skills',p.skills,'Separate your skills with commas or new lines.',3)}<div class="form-grid">${field('GitHub URL','github',p.github,'https://github.com/…','url')}${field('LinkedIn URL','linkedin',p.linkedin,'https://linkedin.com/in/…','url')}</div></section><section class="editor-panel"><h2><span>02 /</span> Your CV, in good hands.</h2><p>${p.cvName ? e(p.cvName) : 'No CV uploaded yet.'}</p><label class="field"><span>Add or replace PDF</span><input type="file" name="cv" accept="application/pdf,.pdf"><small>PDF · up to 10 MiB</small></label>${p.cvId ? `<label class="checkbox"><input type="checkbox" name="removeCv"> Remove the current CV</label>${link('Preview current CV',publicCvUrl(p.cvId),'','external')}${link('Download current CV',publicCvUrl(p.cvId,true),'','download')}` : ''}</section><div class="profile-actions"><span class="fine-print">Saved profile information and your attached PDF are visible to visitors.</span>${p.publicId ? link('View public profile', `#/about/${encodeURIComponent(p.publicId)}${ownerShowroomId ? `?showroom=${encodeURIComponent(ownerShowroomId)}` : ''}`,'text-btn','external') : ''}<button class="btn primary" type="submit">Save profile ${icon('check')}</button></div></form>`;
}
function securityEditor(state, account, oauthStatus) {
  const accountControls = account
    ? `<p>Signed in as ${e(account.email)}.</p>
      <div class="provider-connections">${['google', 'github'].map(provider => {
        const name = provider === 'google' ? 'Google' : 'GitHub';
        return account.linkedProviders?.includes(provider)
          ? `<button class="btn provider-connected" type="button" disabled>${icon('check', 16)} ${name} connected</button>`
          : `<form method="post" action="/api/oauth/${provider}/link"><button class="btn" type="submit">Connect ${name}</button></form>`;
      }).join('')}</div>`
    : `<p>Sign in to connect a provider to your account.</p>${link('Go to sign in','#/signin','primary','arrow')}`;
  const appearance = `<section class="editor-panel appearance-panel" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">Appearance</h2>
    <label class="theme-setting" for="dark-theme">
      <span>Dark mode</span>
      <input id="dark-theme" class="theme-switch" type="checkbox" role="switch"
        ${document.documentElement.dataset.theme === 'dark' ? 'checked' : ''}>
    </label>
  </section>`;
  return `<div class="studio-title"><div><p class="eyebrow">ACCESS & SECURITY</p><h1>A space of your own.</h1><p>Manage how your work will be shared.</p></div></div><section class="editor-panel security-panel"><div class="panel-icon">${icon('lock')}</div><h2>Account connection</h2>${accountControls}<p role="status">${oauthStatus}</p><hr><form id="settings-form"><label class="field"><span>Default permission for future downloads</span><select name="permission">${downloadPermissionOptions(state.settings.permission)}</select></label><p class="fine-print">Preview preference only. Backend authorization is required to protect hosted downloads.</p><button type="submit" class="btn">Save preference ${icon('check')}</button></form></section>${appearance}`;
}
