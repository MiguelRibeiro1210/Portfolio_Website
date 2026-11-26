// Projects and CV data use the backend. Download preferences are preview state.
const initial = () => ({ projects: [], profile: { name: '', role: '', location: '', summary: '', experience: '', education: '', skills: '', email: '', github: '', linkedin: '', cvId: '', cvName: '' }, settings: { permission: 'none' } });
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
    builds: project.build?.id ? [project.build] : [], permission: project.build?.permission };
}
function projectFormData(project, files) {
  const body = new FormData();
  body.append('project', JSON.stringify(project));
  for (const item of files) body.append(item.category === 'media' ? 'media' : 'build', item.file);
  return body;
}

export function rememberProject(project) {
  const index = workspace.projects.findIndex(item => item.id === project.id);
  if (index < 0) workspace.projects.push(project);
  else workspace.projects[index] = project;
}

export async function lookupCollaborator(email) {
  const { account } = await projectRequest('/api/projects/collaborators/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  return account;
}

export async function loadCollaborations() {
  return (await projectRequest('/api/projects/collaborations')).collaborations;
}

export async function leaveProject(id) {
  const response = await authorizedFetch(`/api/projects/${encodeURIComponent(id)}/collaborators/me`, { method: 'DELETE' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'Could not leave this project.');
  }
}

export async function createProject(project, files) {
  const result = await projectRequest('/api/projects', { method: 'POST', body: projectFormData(project, files) });
  const saved = projectView(result.project);
  rememberProject(saved);
  return saved;
}

async function projectRevisionRequest(id, options) {
  const response = await authorizedFetch(`/api/projects/${encodeURIComponent(id)}`, options);
  const result = await response.json().catch(() => null);
  const etag = response.headers.get('ETag');
  if (!response.ok || !result?.project || !etag) {
    const error = new Error(result?.message || 'Could not load or save this project.');
    error.status = response.status;
    throw error;
  }
  return { ...projectView(result.project), etag };
}

export function loadProject(id) {
  return projectRevisionRequest(id);
}

export async function updateProject(current, project, files) {
  const saved = await projectRevisionRequest(current.id, {
    method: 'PUT', headers: { 'If-Match': current.etag }, body: projectFormData(project, files),
  });
  rememberProject(saved);
  return saved;
}

export async function deleteProject(current) {
  const response = await authorizedFetch(`/api/projects/${encodeURIComponent(current.id)}`, {
    method: 'DELETE', headers: { 'If-Match': current.etag },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.message || 'Could not delete this project.');
  }
  workspace.projects = workspace.projects.filter(project => project.id !== current.id);
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

export function showroomPath(id, projectId) {
  const showroom = `#/showroom/${encodeURIComponent(id)}`;
  return projectId ? `${showroom}/${encodeURIComponent(projectId)}` : showroom;
}

function showroomEndpoint(id) {
  return `/api/showrooms/${encodeURIComponent(id)}/projects`;
}

export function showroomFileUrl(id, projectId, fileId) {
  return `${showroomEndpoint(id)}/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
}

export async function loadOwnerShowroom() {
  return (await projectRequest('/api/projects/showroom')).showroom.id;
}

async function publicProjectRequest(path) {
  const response = await fetch(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load the showroom. Please try again.');
  return response.json();
}

export async function loadShowroom(id, projectId) {
  const endpoint = showroomEndpoint(id);
  const collection = await publicProjectRequest(endpoint);
  if (!collection) return null;
  const result = projectId ? await publicProjectRequest(`${endpoint}/${encodeURIComponent(projectId)}`) : null;
  return {
    showroom: collection.showroom,
    projects: projectId ? (result ? [projectView(result.project)] : []) : collection.projects.map(projectView),
  };
}

export async function feedRequest(path, options = {}, publicRead = false) {
  let response;
  if (publicRead) {
    const read = () => fetch(path, { ...options, headers: { ...options.headers, ...(accessToken && { Authorization: `Bearer ${accessToken}` }) } });
    response = await read();
    if (response.status === 401) {
      try {
        if (!await restoreSession()) globalThis.dispatchEvent?.(new Event('session-ended'));
        response = await read();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // Public browsing remains available when session renewal is unavailable.
        response = await fetch(path, options);
      }
      if (response.status === 401) response = await fetch(path, options);
    }
  } else {
    response = await authorizedFetch(path, options);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Object.assign(new Error(result?.message || 'Could not complete the feed request.'), { status: response.status });
  return result;
}
