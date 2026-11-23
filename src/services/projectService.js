import { randomUUID } from 'node:crypto';
import { validateProject, validateProjectUpdate } from '../domain/projectRules.js';

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
    if (!error.commitUncertain) await cleanFiles(storage, stored);
    throw error;
  }
}

async function cleanFiles(storage, ids) {
  if (!ids.length) return;
  try { await storage.remove(ids); }
  catch { console.error('Unable to clean up unreferenced project files. Retry removal for file IDs:', ids.join(', ')); }
}

export async function updateProject(input, files, current, database, storage) {
  const { fields, ordered, build, retainedBuild } = validateProjectUpdate(input, files, current);
  const stored = [];
  async function saveFile(file) {
    const saved = await storage.store(file);
    stored.push(saved.id);
    return saved;
  }

  let result;
  try {
    const project = { ...fields, id: current.id, ownerId: current.ownerId, media: [], build: null };
    for (const { upload, retained } of ordered) project.media.push(retained || await saveFile(upload));
    const nextBuild = build ? await saveFile(build) : retainedBuild;
    if (nextBuild) project.build = { ...nextBuild, permission: fields.permission };
    result = await database.updateProject(project, current.revision);
  } catch (error) {
    if (!error.commitUncertain) await cleanFiles(storage, stored);
    throw error;
  }
  await cleanFiles(storage, result.retired);
  return result;
}

export async function deleteProject(ownerId, id, revision, database, storage) {
  const retired = await database.deleteProject(ownerId, id, revision);
  await cleanFiles(storage, retired);
}
