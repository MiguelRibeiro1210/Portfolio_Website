import { useEffect, useRef, useState } from 'react';
import { FeedIcon } from './FeedIcon.jsx';

export function LikeButton({ post, api, account, updatePost }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  async function toggle() {
    if (request.current) return;
    const controller = request.current = new AbortController();
    setPending(true); setError('');
    try {
      const result = await api.like(post.id, !post.viewerHasLiked, controller.signal);
      if (!controller.signal.aborted) updatePost(post.id, { likeCount: result.likeCount, viewerHasLiked: result.viewerHasLiked });
    } catch (error) {
      if (error.name !== 'AbortError') setError(error.message || 'Could not update your like.');
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false); }
    }
  }
  return <div className="feed-like">
    {account ? <button type="button" className="feed-action" aria-label={post.viewerHasLiked ? 'Unlike project' : 'Like project'} aria-pressed={post.viewerHasLiked} disabled={pending} onClick={toggle}>
      <FeedIcon name="heart" /><span>{post.likeCount} <span className="feed-action-label">{post.likeCount === 1 ? 'like' : 'likes'}</span></span>
    </button> : <a className="feed-action" href="#/signin" aria-label="Sign in to like this project"><FeedIcon name="heart" /><span>{post.likeCount} <span className="feed-action-label">{post.likeCount === 1 ? 'like' : 'likes'}</span></span></a>}
    {error && <p className="feed-inline-error" role="alert">{error}</p>}
  </div>;
}
