import { showroomPath } from './api.js';
import { escapeHTML as e, textarea } from './ui.js';

const roleLabels = {
  owner: 'Owner',
  team_member: 'Team Member',
  simple_participation: 'Simple Participation',
};

export function collaboratorRow(member, creator) {
  const locked = member.creator || (!creator && member.role === 'owner');
  const roles = Object.entries(roleLabels).filter(([role]) => creator || role !== 'owner');
  return `<li class="collaborator-row" data-collaborator="${e(member.showroomId)}"${member.creator ? ' data-creator' : ''}>
    <div><strong>${e(member.name)}</strong><br><span>${e(member.email)}</span></div>
    ${locked ? '<input type="hidden" value="owner" data-role><span>Owner</span>'
      : `<label>Role <select data-role>${roles.map(([role, label]) =>
        `<option value="${role}"${member.role === role ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <button type="button" class="btn" data-remove-collaborator aria-label="Remove ${e(member.name)}">Remove</button>`}
  </li>`;
}

export function collaboratorEditor(project, account, showroomId) {
  const creator = !project.id || project.ownerId === account?.id;
  const members = project.collaborators ?? (account ? [{
    showroomId: showroomId ?? '', name: account.name, email: account.email, role: 'owner', creator: true,
  }] : []);
  return `<section class="editor-panel" aria-labelledby="collaborator-heading">
    <h2 id="collaborator-heading">Collaborators</h2>
    <label class="field">Teammate’s Folio email
      <input id="collaborator-email" type="text" inputmode="email" autocomplete="off" maxlength="254">
    </label>
    <button type="button" class="btn" data-action="find-collaborator">Find teammate</button>
    <p id="collaborator-status" role="status"></p>
    <div id="collaborator-result"></div>
    <ul id="project-collaborators" class="collaborator-list">${members.map(member => collaboratorRow(member, creator)).join('')}</ul>
    ${textarea('Public collaboration notes', 'collaborationNotes', project.collaborationNotes ?? '', 'Credit contributors who are not on Folio.', 3)}
  </section>`;
}

export function projectCredits(project) {
  const members = project.collaborators ?? [];
  if (!members.length && !project.collaborationNotes) return '';
  return `<section class="project-credits"><h2>Collaborators</h2>
    <ul>${members.map(member => `<li><a href="${showroomPath(member.showroomId)}">${e(member.name)}</a> · ${roleLabels[member.role]}</li>`).join('')}</ul>
    ${project.collaborationNotes ? `<p class="preserve-lines">${e(project.collaborationNotes)}</p>` : ''}
  </section>`;
}

export function collaborationList(collaborations, showroomId) {
  if (!collaborations.length) return '';
  return `<section class="editor-panel" aria-label="Your collaborations"><h2>Your collaborations</h2>
    <ul class="collaborator-list">${collaborations.map(project => `<li class="collaborator-row">
      <span>${project.published && showroomId
        ? `<a href="${showroomPath(showroomId, project.id)}">${e(project.title)}</a>`
        : e(project.title ?? 'Unpublished project')} · ${roleLabels[project.role]}</span>
      <button type="button" class="btn" data-leave-project="${e(project.id)}">Leave project</button>
    </li>`).join('')}</ul>
  </section>`;
}
