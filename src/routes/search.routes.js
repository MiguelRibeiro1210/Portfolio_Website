import express from 'express';
import { getSearchSuggestions } from '../services/searchService.js';

export function createSearchRouter(getDatabase) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Public, identical results regardless of supplied session credentials.
  router.get('/suggestions', async (req, res) => {
    res.json(await getSearchSuggestions(getDatabase, req.query));
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 503].includes(error.status) ? error.status : 500;
    res.status(status).json({ message: status === 400 ? error.message :
      status === 503 ? 'Search is temporarily unavailable. Please try again.' : 'Unable to complete the search request.' });
  });
  return router;
}
