import express from 'express';
import multer from 'multer';
import { createWriteStream, unlink } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireAuth } from '../middleware/requireAuth.js';
import { isUUID, projectError, projectLimits } from '../domain/projectRules.js';
import { createProject, updateProject, deleteProject } from '../services/projectService.js';
import { createFileStorage } from '../services/fileStorageService.js';

function expectedRevision(req) {
  const header = req.get('If-Match');
  if (!header) throw projectError('Load the project before saving or deleting it.', 428);
  const match = /^"([1-9]\d*)"$/.exec(header);
  const revision = Number(match?.[1]);
  if (!Number.isSafeInteger(revision) || revision > 2147483647) throw projectError('Invalid project revision.');
  return revision;
}

const projectTag = revision => `"${revision}"`;

export function createProjectRouter(getDatabase, { jwtSecret }, storage = createFileStorage()) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireAuth(getDatabase, jwtSecret));
  const upload = multer({
    storage: {
      _handleFile(req, file, done) {
        const path = join(req.uploadStage, randomUUID());
        let size = 0;
        const limit = file.fieldname === 'media' ? projectLimits.mediaSize : projectLimits.buildSize;
        const counter = new Transform({ transform(chunk, encoding, callback) {
          size += chunk.length;
          req.uploadBytes = (req.uploadBytes || 0) + chunk.length;
          callback(size > limit || req.uploadBytes > projectLimits.totalSize ?
            projectError('Uploads exceed the file or combined size limit.', 413) : null, chunk);
        } });
        pipeline(file.stream, counter, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
          .then(() => done(null, { path, size }), done);
      },
      _removeFile(req, file, done) { unlink(file.path, done); },
    },
    limits: { fileSize: projectLimits.buildSize, files: 11, fields: 1, fieldSize: 64 * 1024, parts: 12 },
  }).fields([{ name: 'media', maxCount: projectLimits.mediaCount }, { name: 'build', maxCount: 1 }]);

  async function save(req, res, next) {
    let stage;
    try {
      let current;
      let database;
      if (req.params.id !== undefined) {
        if (!isUUID(req.params.id)) throw projectError('Project not found.', 404);
        database = await getDatabase();
        current = await database.findProject(req.user.id, req.params.id);
        if (!current) throw projectError('Project not found.', 404);
        if (current.revision !== expectedRevision(req)) {
          throw projectError('Project changed. Reload it before trying again.', 412);
        }
      }
      if (!req.is('multipart/form-data')) throw projectError('Submit project details and files as multipart/form-data.');
      if (Number(req.get('Content-Length')) > projectLimits.totalSize + 128 * 1024) throw projectError('Request exceeds the 300 MiB upload limit.', 413);
      stage = await storage.stage();
      req.uploadStage = stage;
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (Object.keys(req.body).some(key => key !== 'project') || typeof req.body.project !== 'string') throw projectError('Supply one JSON project part.');
      let input;
      try { input = JSON.parse(req.body.project); } catch { throw projectError('Invalid project JSON.'); }
      const files = [...(req.files?.media ?? []), ...(req.files?.build ?? [])];
      if (current) {
        const result = await updateProject(input, files, current, database, storage);
        return res.set('ETag', projectTag(result.revision)).json({ project: result.project });
      }
      const project = await createProject(input, files, req.user.id, await getDatabase(), storage);
      res.status(201).json({ project });
    } catch (error) { next(error); }
    finally {
      if (stage) {
        try { await storage.discard(stage); }
        catch { console.error('Unable to clean up a project upload staging directory.'); }
      }
    }
  }
  router.post('/', save);
  router.put('/:id', save);

  router.get('/', async (req, res) => {
    res.json({ projects: await (await getDatabase()).listProjects(req.user.id) });
  });
  router.get('/files/:id', async (req, res, next) => {
    if (!isUUID(req.params.id)) return res.status(404).json({ message: 'File not found.' });
    const file = await (await getDatabase()).findProjectFile(req.user.id, req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found.' });
    // Owners can retrieve their own builds regardless of visitor download settings.
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(file.type);
    res.download(storage.path(file.id), file.name, error => {
      if (error && !res.headersSent) {
        if (error.code === 'ENOENT') res.status(404).json({ message: 'File is unavailable.' });
        else next(error);
      }
    });
  });
  router.get('/:id', async (req, res) => {
    if (!isUUID(req.params.id)) return res.status(404).json({ message: 'Project not found.' });
    const project = await (await getDatabase()).findProject(req.user.id, req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    const { revision, ...fields } = project;
    res.set('ETag', projectTag(revision)).json({ project: fields });
  });
  router.delete('/:id', async (req, res) => {
    if (!isUUID(req.params.id)) throw projectError('Project not found.', 404);
    const database = await getDatabase();
    await deleteProject(req.user.id, req.params.id, expectedRevision(req), database, storage);
    res.status(204).end();
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const tooLarge = error instanceof multer.MulterError && ['LIMIT_FILE_SIZE', 'LIMIT_FIELD_VALUE'].includes(error.code);
    const status = tooLarge ? 413 : error instanceof multer.MulterError ? 400 : error.status || 500;
    res.status(status).json({ message: status === 500 ? 'Unable to complete the project request.' :
      tooLarge ? 'An uploaded file or project details exceed the size limit.' :
      error instanceof multer.MulterError ? 'Invalid upload fields or too many files. Select up to 10 media files and one build.' : error.message });
  });
  return router;
}
