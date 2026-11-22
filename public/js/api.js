// Backend integration boundary. Replace these methods with API requests when ready.
// This temporary adapter holds preview state in memory only; a reload discards it.
const initial = () => ({ projects: [], profile: { name: '', role: '', location: '', summary: '', experience: '', education: '', skills: '', email: '', github: '', linkedin: '', cvId: '', cvName: '' }, settings: { permission: 'request' } });
let workspace = initial();
let previewFiles = new Map();

export const repository = {
  async load() {
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
    return previewFiles.get(id);
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

async function loadAccount(accessToken) {
  const response = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.user) throw new Error('Could not load your account.');
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
  // Tabs share the refresh cookie. Serialize rotation where Web Locks are available.
  const refresh = async () => {
    const response = await fetch('/api/refresh', { method: 'POST' });
    if (response.status === 401) return null;
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.accessToken) throw new Error('Could not restore your session.');
    return loadAccount(result.accessToken);
  };
  return withSessionLock(refresh);
}

function withSessionLock(operation) {
  return navigator.locks ? navigator.locks.request('folio-session', operation) : operation();
}

export async function signOut() {
  await withSessionLock(async () => {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
  });
}
