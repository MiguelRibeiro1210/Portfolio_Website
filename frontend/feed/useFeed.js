import { useCallback, useEffect, useRef, useState } from 'react';
import { appendUnique } from './feedApi.js';

export function useFeed(api, account) {
  const [state, setState] = useState({ posts: [], loading: true, error: '', nextCursor: null, started: false });
  const current = useRef(state);
  const active = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const controller = useRef(null);
  const pages = useRef([]);
  const accountId = account?.id ?? null;
  const [refreshRevision, setRefreshRevision] = useState(0);
  const identityError = useRef(false);
  const commit = useCallback(update => {
    current.current = typeof update === 'function' ? update(current.current) : update;
    if (active.current) setState(current.current);
  }, []);

  const loadMore = useCallback(async () => {
    const before = current.current;
    if (!active.current || busy.current || (before.started && !before.nextCursor)) return;
    const version = generation.current;
    const cursor = before.started ? before.nextCursor : null;
    busy.current = true;
    const request = controller.current = new AbortController();
    commit(value => ({ ...value, loading: true, error: '' }));
    try {
      const result = await api.posts(cursor, request.signal);
      if (!active.current || version !== generation.current) return;
      if (result.nextCursor !== null && (result.nextCursor === cursor || pages.current.some(p => p.cursor === result.nextCursor))) {
        throw new Error('The feed could not advance. Please refresh and try again.');
      }
      pages.current.push({ cursor, ids: result.posts.map(post => post.id) });
      commit(value => ({ ...value, posts: appendUnique(value.posts, result.posts), nextCursor: result.nextCursor, started: true, error: '' }));
    } catch (error) {
      if (error.name !== 'AbortError' && version === generation.current) commit(value => ({ ...value, error: error.message || 'Could not load projects.' }));
    } finally {
      if (version === generation.current) {
        busy.current = false;
        commit(value => ({ ...value, loading: false }));
      }
    }
  }, [api, commit]);

  useEffect(() => {
    active.current = true;
    void loadMore();
    return () => {
      active.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, [loadMore]);

  // Session restoration can finish after the anonymous first page. Refresh only
  // pages already requested, without changing order or fetching the unseen feed.
  const previousAccount = useRef(accountId);
  const previousRefresh = useRef(0);
  useEffect(() => {
    if (previousAccount.current === accountId && previousRefresh.current === refreshRevision) return;
    previousAccount.current = accountId; previousRefresh.current = refreshRevision;
    identityError.current = false;
    const version = ++generation.current;
    controller.current?.abort();
    busy.current = true;
    const request = controller.current = new AbortController();
    commit(value => ({ ...value, posts: value.posts.map(post => ({ ...post, viewerHasLiked: false })), loading: true, error: '' }));
    (async () => {
      try {
        for (const page of pages.current) {
          const result = await api.posts(page.cursor, request.signal);
          if (!active.current || generation.current !== version) return;
          const refreshed = new Map(result.posts.map(post => [post.id, post]));
          commit(value => ({ ...value, posts: value.posts.map(post => refreshed.get(post.id) ?? post) }));
        }
      } catch (error) {
        if (error.name !== 'AbortError' && generation.current === version) { identityError.current = true; commit(value => ({ ...value, error: error.message })); }
      } finally {
        if (generation.current === version) {
          busy.current = false;
          commit(value => ({ ...value, loading: false }));
          if (!current.current.started) void loadMore();
        }
      }
    })();
  }, [accountId, api, commit, loadMore, refreshRevision]);

  const updatePost = useCallback((id, fields) => commit(value => ({ ...value, posts: value.posts.map(post => post.id === id ? { ...post, ...fields } : post) })), [commit]);
  const retry = useCallback(() => { if (identityError.current) setRefreshRevision(value => value + 1); else void loadMore(); }, [loadMore]);
  return { ...state, loadMore, retry, updatePost };
}
