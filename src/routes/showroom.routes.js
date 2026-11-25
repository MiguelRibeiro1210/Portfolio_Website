import express from 'express';
import { isUUID } from '../domain/projectRules.js';
import { createProjectStorage } from '../services/projectStorage.js';
import { sendProjectFile } from '../services/sendProjectFile.js';

function publicProject({ ownerId, notes, build, ...project }) {
  const publicBuild = build && (build.permission === 'public' ? build : { permission: build.permission });
  return {
    ...project,
    notes: notes && project.type === 'private' ? { ...notes, source: '' } : notes,
    build: publicBuild,
  };
}

function notFound(res) {
  return res.status(404).json({ message: 'Showroom, project, or file not found.' });
}

export function createShowroomRouter(getDatabase, storage = createProjectStorage()) {
  const router = express.Router();
  router.use((req, res, next) => {
    // A project can be hidden or a build permission changed at any time.
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/:showroomId/projects', async (req, res) => {
    const { showroomId } = req.params;
    if (!isUUID(showroomId)) return notFound(res);
    const db = await getDatabase();
    const showroom = await db.findPublicShowroom(showroomId);
    if (!showroom) return notFound(res);
    const projects = await db.listPublicProjects(showroomId);
    res.json({ showroom, projects: projects.map(publicProject) });
  });

  router.get('/:showroomId/projects/:projectId', async (req, res) => {
    const { showroomId, projectId } = req.params;
    if (!isUUID(showroomId) || !isUUID(projectId)) return notFound(res);
    const project = await (await getDatabase()).findPublicProject(showroomId, projectId);
    if (!project) return notFound(res);
    res.json({ project: publicProject(project) });
  });

  router.get('/:showroomId/projects/:projectId/files/:fileId', async (req, res, next) => {
    const { showroomId, projectId, fileId } = req.params;
    if (![showroomId, projectId, fileId].every(isUUID)) return notFound(res);
    const file = await (await getDatabase()).findPublicProjectFile(showroomId, projectId, fileId);
    if (!file) return notFound(res);

    if (file.kind === 'build') res.attachment(file.name);
    else res.set('Content-Disposition', 'inline');
    res.type(file.type).set('X-Content-Type-Options', 'nosniff');
    await sendProjectFile(req, res, storage, file);
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.status === 404) return notFound(res);
    const status = [416, 503].includes(error.status) ? error.status : 500;
    res.status(status).json({
      message: status === 416 ? 'Invalid file range.' : 'Unable to load the showroom.',
    });
  });
  return router;
}
