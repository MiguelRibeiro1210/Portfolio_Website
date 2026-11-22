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
  }
};
export async function authenticate() {
  return { connected: false, message: 'Sign-in will be available when authentication is connected. You can explore the frontend preview now.' };
}
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
