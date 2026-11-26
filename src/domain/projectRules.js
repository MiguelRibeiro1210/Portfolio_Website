const MiB = 1024 * 1024;
export const projectLimits = { mediaCount: 10, mediaSize: 20 * MiB, buildSize: 100 * MiB, totalSize: 300 * MiB };
export const isUUID = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
export function projectError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validateProject(input, files, selection) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw projectError('Project details must be an object.');
  const allowed = ['title', 'type', 'description', 'stack', 'published', 'story', 'compatibility', 'source', 'releaseNotes', 'permission', 'collaborators', 'collaborationNotes'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw projectError('Unexpected project field. Ownership is assigned by the server.');
  const text = (key, max, required = false) => {
    const value = input[key];
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
      throw projectError(`${key} must contain ${required ? '1' : '0'}–${max} characters.`);
    }
    return value.trim();
  };
  const project = { title: text('title', 200, true), description: text('description', 5000, true), stack: text('stack', 1000, true) };
  if (!['open', 'private'].includes(input.type)) throw projectError('Choose a valid showcase type.');
  if (typeof input.published !== 'boolean') throw projectError('Collection visibility must be a boolean.');
  project.type = input.type;
  project.published = input.published;
  const notes = { story: text('story', 10000), compatibility: text('compatibility', 2000), source: text('source', 2048), releaseNotes: text('releaseNotes', 10000) };
  if (notes.source) {
    let url;
    try { url = new URL(notes.source); } catch { /* handled below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw projectError('Use an HTTP or HTTPS repository URL without credentials.');
    }
  }
  project.notes = Object.values(notes).some(Boolean) ? notes : null;
  if (input.collaborationNotes !== undefined) project.collaborationNotes = text('collaborationNotes', 5000);
  if (input.collaborators !== undefined) {
    if (!Array.isArray(input.collaborators) || input.collaborators.length > 50) {
      throw projectError('Select up to 50 collaborators.');
    }
    const seen = new Set();
    project.collaborators = input.collaborators.map(entry => {
      if (!entry || typeof entry.showroomId !== 'string' || !isUUID(entry.showroomId) ||
          !['owner', 'team_member', 'simple_participation'].includes(entry.role)) {
        throw projectError('Choose a Folio account and a valid role for each collaborator.');
      }
      const showroomId = entry.showroomId.toLowerCase();
      if (seen.has(showroomId)) throw projectError('Each collaborator can only be added once.');
      seen.add(showroomId);
      return { showroomId, role: entry.role };
    });
  }
  const media = files.filter(file => file.fieldname === 'media');
  const builds = files.filter(file => file.fieldname === 'build');
  const mediaCount = selection?.mediaCount ?? media.length;
  const hasBuild = selection?.hasBuild ?? Boolean(builds.length);
  if (!mediaCount || mediaCount > projectLimits.mediaCount) throw projectError('Select 1–10 gallery images or videos.');
  if (builds.length > 1) throw projectError('Select at most one build.');
  if (hasBuild && !['public', 'request', 'none'].includes(input.permission)) throw projectError('Choose a valid download permission.');
  if (files.reduce((sum, file) => sum + file.size, 0) > projectLimits.totalSize) throw projectError('Combined uploads exceed 300 MiB.', 413);
  for (const file of files) {
    if (!file.size) throw projectError('Empty files are not supported.');
    if (file.size > (file.fieldname === 'media' ? projectLimits.mediaSize : projectLimits.buildSize)) {
      throw projectError(`${file.originalname}: file is too large.`, 413);
    }
  }
  return { ...project, permission: hasBuild ? input.permission : null };
}

export function validateProjectUpdate(input, files, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw projectError('Project details must be an object.');
  const { mediaOrder, buildAction, ...details } = input;
  if (!Array.isArray(mediaOrder) || mediaOrder.length < 1 || mediaOrder.length > projectLimits.mediaCount) {
    throw projectError('Select 1–10 gallery images or videos.');
  }
  const media = files.filter(file => file.fieldname === 'media');
  const build = files.find(file => file.fieldname === 'build');
  const existing = new Map(current.media.map(file => [file.id, file]));
  const usedUploads = new Set();
  const usedExisting = new Set();
  const ordered = mediaOrder.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 1) {
      throw projectError('Invalid gallery order.');
    }
    if (Number.isInteger(entry.uploadIndex) && media[entry.uploadIndex] && !usedUploads.has(entry.uploadIndex)) {
      usedUploads.add(entry.uploadIndex);
      return { upload: media[entry.uploadIndex] };
    }
    if (existing.has(entry.fileId) && !usedExisting.has(entry.fileId)) {
      usedExisting.add(entry.fileId);
      return { retained: existing.get(entry.fileId) };
    }
    throw projectError('Gallery contains an unknown or duplicate file.');
  });
  if (usedUploads.size !== media.length) throw projectError('Every uploaded media file must appear in the gallery.');
  if (!['keep', 'replace', 'remove'].includes(buildAction) || (buildAction === 'replace') !== Boolean(build)) {
    throw projectError('A replacement requires one build file. Retaining or removing it requires no upload.');
  }
  const retainedBuild = buildAction === 'keep' ? current.build : null;
  const fields = validateProject(details, files, { mediaCount: ordered.length, hasBuild: Boolean(build || retainedBuild) });
  return { fields, ordered, build, retainedBuild };
}
