import { randomUUID } from 'node:crypto';
import { validateProject } from '../domain/projectRules.js';

export async function createProject(input, files, ownerId, database, storage) {
  const validated = validateProject(input, files);
  const stored = [];
  try {
    const project = { ...validated, id: randomUUID(), ownerId, media: [], build: null };
    for (const file of files) {
      const saved = await storage.store(file);
      stored.push(saved.id);
      if (file.fieldname === 'media') project.media.push(saved);
      else project.build = { ...saved, permission: validated.permission };
    }
    return await database.createProject(project);
  } catch (error) {
    try { await storage.remove(stored); }
    catch { console.error('Unable to clean up unreferenced project files.'); }
    throw error;
  }
}
