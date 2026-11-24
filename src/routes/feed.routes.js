import express from 'express';
import { optionalAuth } from '../middleware/optionalAuth.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { feedError, requirePostId } from '../domain/feedRules.js';
import { addComment, getFeed, getFeedComments, setLike } from '../services/feedService.js';
import { createFileStorage } from '../services/fileStorageService.js';

export function createFeedRouter(getDatabase, { jwtSecret }, storage = createFileStorage()) {
  const router = express.Router();
  const authenticate = requireAuth(getDatabase, jwtSecret);
  const optional = optionalAuth(getDatabase, jwtSecret);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/', optional, async (req, res) => {
    res.json(await getFeed(await getDatabase(), req.query, req.user?.id));
  });
  router.get('/posts/:postId/media', optional, async (req, res, next) => {
    const file = await (await getDatabase()).findFeedCover(requirePostId(req.params.postId));
    if (!file) throw feedError('Feed media not found.', 404);
    res.set('Content-Disposition', 'inline').set('X-Content-Type-Options', 'nosniff').type(file.type);
    res.sendFile(storage.path(file.id), { cacheControl: false, lastModified: false, etag: false }, error => {
      if (!error) return;
      if (res.headersSent) return next(error);
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Type');
      next(error.code === 'ENOENT' || error.status === 404 ? feedError('Feed media not found.', 404) : error);
    });
  });
  router.get('/posts/:postId/comments', optional, async (req, res) => {
    res.json(await getFeedComments(await getDatabase(), req.params.postId, req.query));
  });
  router.put('/posts/:postId/like', authenticate, async (req, res) => {
    res.json(await setLike(await getDatabase(), req.params.postId, req.user.id, true));
  });
  router.delete('/posts/:postId/like', authenticate, async (req, res) => {
    res.json(await setLike(await getDatabase(), req.params.postId, req.user.id, false));
  });
  router.post('/posts/:postId/comments', authenticate, express.json({ limit: '16kb' }), async (req, res) => {
    if (!req.is('application/json')) throw feedError('Submit comments as application/json.');
    res.status(201).json(await addComment(await getDatabase(), req.params.postId, req.user.id, req.body));
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.parse.failed' ? 400 : error.status || 500;
    res.status(status).json({ message: status >= 500 ? 'Unable to complete the feed request.' :
      error.type === 'entity.parse.failed' ? 'Invalid JSON request body.' :
      status === 416 ? 'Invalid file range.' :
      status === 413 ? 'Comment request is too large.' : error.message });
  });
  return router;
}
