import { publicCvUrl, showroomPath } from './api.js';
import { escapeHTML as e, link, placeholder } from './ui.js';
import { projectCard } from './project.js';

export function aboutPage(state, tab = 'about', owner = false, viewer = null) {
  const p = state.profile;
  const projects = (state.projects ?? []).filter(project => project.published);
  const tabs = { about: 'About', projects: 'Projects', experience: 'Experience', education: 'Education', skills: 'Skills', contact: 'Contact' };
  const selected = Object.hasOwn(tabs, tab) ? tab : 'about';
  const contact = p.email || p.github || p.linkedin;
  const accountLinks = `
    ${p.github ? `<a href="${e(p.github)}" rel="noopener noreferrer">GitHub ↗</a>` : ''}
    ${p.linkedin ? `<a href="${e(p.linkedin)}" rel="noopener noreferrer">LinkedIn ↗</a>` : ''}`;
  const projectSection = projects.length ? `<section class="profile-section">
    <div class="profile-section-heading"><h2>Selected projects</h2>
      ${viewer ? link('View showroom', showroomPath(viewer.id), 'text-btn', 'external') : ''}
    </div><div class="profile-project-grid">${projects.slice(0, 2).map((item, index) => projectCard(item, index, viewer)).join('')}</div>
  </section>` : '';
  const record = (title, value, hint) => `<section class="profile-section"><h2>${title}</h2>
    <div class="profile-entry preserve-lines">${value ? e(value) : placeholder(hint)}</div></section>`;
  const experience = record('Experience', p.experience, 'No experience added.');
  const education = record('Education', p.education, 'No education added.');
  const skillSection = record('Skills & tools', p.skills, 'No skills added.');
  const content = {
    about: `<h2 class="profile-role">${p.role ? e(p.role) : 'About this profile'}</h2>
      <p class="preserve-lines">${p.summary ? e(p.summary) : placeholder('No introduction added.')}</p>
      ${projectSection}${experience}${education}${skillSection}`,
    projects: projectSection || '<p>No published projects yet.</p>',
    experience,
    education,
    skills: skillSection,
    contact: `<section class="profile-section"><h2>Contact</h2>
      ${p.email ? `<a href="mailto:${e(p.email)}">${e(p.email)}</a>` : ''}
      ${contact ? `<div class="profile-social">${accountLinks}</div>` : '<p>No contact details added.</p>'}
    </section>`,
  };
  return `<div class="profile-page section-pad">
    <p class="profile-breadcrumb">Showroom / About & CV</p>
    <div class="about-layout"><aside class="profile-sidebar">
      <section class="about-identity">
        <p class="eyebrow">Builder profile</p>
        <h2>${p.name ? e(p.name) : placeholder('Your name')}</h2>
        ${p.role ? `<p class="identity-role">${e(p.role)}</p>` : ''}
        ${p.summary ? `<p class="identity-summary preserve-lines">${e(p.summary)}</p>` : ''}
        ${p.location ? `<p class="identity-location">${e(p.location)}</p>` : ''}
        ${p.email ? `<a class="btn primary full" href="mailto:${e(p.email)}">Get in touch ↗</a>` : ''}
        ${p.github || p.linkedin ? `<div class="profile-social">${accountLinks}</div>` : ''}
      </section>
      ${p.cvId ? `<section class="profile-cv">
        <iframe title="CV document preview" loading="lazy" src="${publicCvUrl(p.cvId)}#toolbar=0"></iframe>
        <p class="fine-print">${e(p.cvName)}</p>
        ${link('Download CV', publicCvUrl(p.cvId, true), 'full', 'download')}
        ${link('Preview CV', publicCvUrl(p.cvId), 'text-btn', 'external')}
      </section>` : owner ? `<section class="profile-cv">${link('Add your CV', '#/studio?section=profile', '', 'plus')}</section>` : ''}
    </aside><div class="about-content">
      <h1 class="profile-heading">Behind the projects.</h1>
      <div class="tabs" role="tablist" aria-label="About sections">
        ${Object.entries(tabs).map(([key, label]) => `<button type="button" role="tab" id="about-tab-${key}"
          aria-controls="about-panel" aria-selected="${selected === key}" tabindex="${selected === key ? 0 : -1}"
          class="${selected === key ? 'active' : ''}" data-about-tab="${key}">${label}</button>`).join('')}
      </div>
      <section id="about-panel" class="about-panel" role="tabpanel" aria-labelledby="about-tab-${selected}">${content[selected]}</section>
    </div></div>
  </div>`;
}
