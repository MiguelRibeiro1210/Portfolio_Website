// Projects and CV data use the backend. Download preferences are preview state.
const initial = () => ({ projects: [], profile: { name: '', role: '', location: '', summary: '', experience: '', education: '', skills: '', email: '', github: '', linkedin: '', cvId: '', cvName: '' }, settings: { permission: 'request' } });
let workspace = initial();
let previewFiles = new Map();
let accessToken = null;
let refreshPending;

export const repository = {
  async load() {
    if (accessToken) {
      const result = await projectRequest('/api/projects');
      workspace.projects = result.projects.map(projectView);
    }
    return structuredClone(workspace);
  },
  async save(state, files = [], removeIds = []) {
    const next = structuredClone(state);
    const nextFiles = new Map(previewFiles);
    for (const item of files) nextFiles.set(item.id, item.file);
    for (const id of removeIds) nextFiles.delete(id);
    workspace = next;
    previewFiles = nextFiles;
  },
  async file(id) {
    if (previewFiles.has(id)) return previewFiles.get(id);
    const response = await authorizedFetch(`/api/projects/files/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('This project file could not be loaded.');
    const file = await response.blob();
    const metadata = workspace.projects.flatMap(p => [...p.media, ...p.builds]).find(f => f.id === id);
    return Object.assign(file, { name: metadata?.name || 'Project file' });
  },
  reset() {
    workspace = initial();
    previewFiles.clear();
    return structuredClone(workspace);
  },
};
export const emptyWorkspace = initial;

export async function registerAccount({ name, email, password }) {
  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.user) {
    throw new Error(result?.message || 'Could not create the account.');
  }

  return result.user;
}

async function loadAccount(token) {
  const response = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.user) throw new Error('Could not load your account.');
  accessToken = token;
  return result.user;
}

export async function signIn({ email, password }) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.accessToken) {
    throw new Error(result?.message || 'Could not sign in.');
  }
  return loadAccount(result.accessToken);
}

export async function restoreSession() {
  // Serialize refreshes within this tab and across tabs sharing the refresh cookie.
  if (!refreshPending) {
    refreshPending = withSessionLock(async () => {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (response.status === 401) { accessToken = null; return null; }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.accessToken) throw new Error('Could not restore your session.');
      return loadAccount(result.accessToken);
    }).finally(() => { refreshPending = undefined; });
  }
  return refreshPending;
}

async function authorizedFetch(path, options = {}) {
  const request = () => fetch(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken || ''}` } });
  let response = await request();
  if (response.status === 401) {
    const user = await restoreSession();
    if (!user) {
      globalThis.dispatchEvent?.(new Event('session-ended'));
      throw new Error('Your session has ended. Sign in to continue.');
    }
    response = await request();
  }
  return response;
}
async function projectRequest(path, options) {
  const response = await authorizedFetch(path, options);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message || 'Could not load or save projects.');
  return result;
}
function projectView(project) {
  return { ...project, story: project.notes?.story || '', compatibility: project.notes?.compatibility || '',
    source: project.notes?.source || '', releaseNotes: project.notes?.releaseNotes || '',
    builds: project.build ? [project.build] : [], permission: project.build?.permission || 'request' };
}
export async function createProject(project, files) {
  const body = new FormData();
  const fields = ['title', 'type', 'description', 'stack', 'story', 'compatibility', 'source', 'releaseNotes', 'permission', 'published'];
  body.append('project', JSON.stringify(Object.fromEntries(fields.map(key => [key, project[key]]))));
  for (const item of files) body.append(item.category === 'media' ? 'media' : 'build', item.file);
  const result = await projectRequest('/api/projects', { method: 'POST', body });
  const saved = projectView(result.project);
  workspace.projects.push(saved);
  return saved;
}

function withSessionLock(operation) {
  return navigator.locks ? navigator.locks.request('folio-session', operation) : operation();
}

export async function signOut() {
  await withSessionLock(async () => {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    accessToken = null;
  });
}

function profileView(profile) {
  const { attachment, ...fields } = profile ?? {};
  return {
    ...initial().profile, ...fields,
    cvId: attachment ? fields.publicId : '',
    cvName: attachment?.name ?? '',
  };
}

async function profileRequest(path, options, request = authorizedFetch) {
  const response = await request(path, options);
  if (request === fetch && response.status === 404) return null;
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.message || 'Could not load or save the profile.');
  return profileView(result.profile);
}

export function loadOwnerProfile() {
  return profileRequest('/api/profile/me');
}

export function saveOwnerProfile(body) {
  return profileRequest('/api/profile/me', { method: 'PUT', body });
}

export function loadPublicProfile(id) {
  return profileRequest(`/api/profiles/${encodeURIComponent(id)}`, undefined, fetch);
}

export function publicCvUrl(id, download = false) {
  return `/api/profiles/${encodeURIComponent(id)}/cv${download ? '?download=1' : ''}`;
}
