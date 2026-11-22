const MiB = 1024 * 1024;
export const projectLimits = { mediaCount: 10, mediaSize: 20 * MiB, buildSize: 100 * MiB, totalSize: 300 * MiB };
export const isUUID = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '');
export function projectError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validateProject(input, files) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw projectError('Project details must be an object.');
  const allowed = ['title', 'type', 'description', 'stack', 'published', 'story', 'compatibility', 'source', 'releaseNotes', 'permission'];
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
  const media = files.filter(file => file.fieldname === 'media');
  const builds = files.filter(file => file.fieldname === 'build');
  if (!media.length || media.length > projectLimits.mediaCount) throw projectError('Select 1–10 gallery images or videos.');
  if (builds.length > 1) throw projectError('Select at most one build.');
  if (builds.length && !['public', 'request', 'none'].includes(input.permission)) throw projectError('Choose a valid download permission.');
  if (files.reduce((sum, file) => sum + file.size, 0) > projectLimits.totalSize) throw projectError('Combined uploads exceed 300 MiB.', 413);
  for (const file of files) {
    if (!file.size) throw projectError('Empty files are not supported.');
    if (file.size > (file.fieldname === 'media' ? projectLimits.mediaSize : projectLimits.buildSize)) {
      throw projectError(`${file.originalname}: file is too large.`, 413);
    }
  }
  return { ...project, permission: builds.length ? input.permission : null };
}
