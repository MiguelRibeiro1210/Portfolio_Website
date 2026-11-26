import { projectError } from '../domain/projectRules.js';

export const collaboratorJoin = `JOIN portfolio.project_collaborators membership ON membership.project_id = p.id
  JOIN portfolio.users u ON u.id = membership.user_id`;

export const editorMembership = `EXISTS (SELECT 1 FROM portfolio.project_collaborators editor
  WHERE editor.project_id = p.id AND editor.user_id = $1 AND editor.role = 'owner')`;

export const editorFields = `p.collaboration_notes AS "collaborationNotes",
  (SELECT COALESCE(json_agg(json_build_object('showroomId', u.showroom_id, 'name', u.name,
    'email', u.email, 'role', c.role, 'creator', c.user_id = p.owner_id)
    ORDER BY (c.user_id = p.owner_id) DESC, u.name, u.showroom_id), '[]')
   FROM portfolio.project_collaborators c JOIN portfolio.users u ON u.id = c.user_id
   WHERE c.project_id = p.id) AS collaborators`;

export const publicCollaborationFields = `p.collaboration_notes AS "collaborationNotes",
  (SELECT COALESCE(json_agg(json_build_object('showroomId', u.showroom_id, 'name', u.name,
    'role', c.role, 'creator', c.user_id = p.owner_id)
    ORDER BY (c.user_id = p.owner_id) DESC, u.name, u.showroom_id), '[]')
   FROM portfolio.project_collaborators c JOIN portfolio.users u ON u.id = c.user_id
   WHERE c.project_id = p.id) AS collaborators`;

export async function saveCollaborators(client, project, actorId, creating = false) {
  if (!creating && project.collaborators === undefined) return;
  const entries = project.collaborators ?? [];
  const { rows: accounts } = await client.query(
    'SELECT id, showroom_id FROM portfolio.users WHERE showroom_id = ANY($1::uuid[])',
    [entries.map(entry => entry.showroomId)],
  );
  if (accounts.length !== entries.length) throw projectError('A collaborator account could not be found.');
  const ids = new Map(accounts.map(account => [account.showroom_id, account.id]));
  const roles = new Map(entries.map(entry => [ids.get(entry.showroomId), entry.role]));
  if (roles.has(project.ownerId)) throw projectError('The creator is already an owner.');
  if (actorId !== project.ownerId) {
    const { rows } = await client.query(
      "SELECT user_id FROM portfolio.project_collaborators WHERE project_id = $1 AND role = 'owner' AND user_id <> $2",
      [project.id, project.ownerId],
    );
    const existing = new Set(rows.map(row => row.user_id));
    if (rows.some(row => roles.get(row.user_id) !== 'owner') ||
        [...roles].some(([id, role]) => role === 'owner' && !existing.has(id))) {
      throw projectError('Only the creator can change other owners.', 403);
    }
  }
  await client.query('DELETE FROM portfolio.project_collaborators WHERE project_id = $1 AND user_id <> $2',
    [project.id, project.ownerId]);
  if (creating) roles.set(project.ownerId, 'owner');
  if (roles.size) {
    await client.query(`INSERT INTO portfolio.project_collaborators (project_id, user_id, role)
      SELECT $1, user_id, role FROM unnest($2::integer[], $3::text[]) AS members(user_id, role)`,
    [project.id, [...roles.keys()], [...roles.values()]]);
  }
}
