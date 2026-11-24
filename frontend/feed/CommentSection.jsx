import { useEffect, useRef, useState } from 'react';
import { appendUnique } from './feedApi.js';

function Comment({ comment }) {
  return <li className="feed-comment"><div className="feed-comment-meta"><strong>{comment.author.name}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div><p>{comment.text}</p></li>;
}

export function CommentSection({ post, api, account, updatePost, open }) {
  const [comments, setComments] = useState([]);
  const [recent, setRecent] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const reads = useRef(null);
  const write = useRef(null);
  const page = useRef({ started: false, cursor: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reads.current?.abort(); write.current?.abort(); }; }, []);

  async function load() {
    if (reads.current || (page.current.started && !page.current.cursor)) return;
    const controller = reads.current = new AbortController();
    setLoading(true); setLoadError('');
    try {
      const result = await api.comments(post.id, page.current.cursor, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (result.nextCursor && result.nextCursor === page.current.cursor) throw new Error('Could not load the next comments.');
      page.current = { started: true, cursor: result.nextCursor };
      setComments(value => appendUnique(value, result.comments));
      const fetched = new Set(result.comments.map(comment => comment.id));
      setRecent(value => value.filter(comment => !fetched.has(comment.id)));
      setStarted(true); setCursor(result.nextCursor);
    } catch (error) { if (error.name !== 'AbortError' && mounted.current) setLoadError(error.message || 'Could not load comments.'); }
    finally { if (mounted.current) { reads.current = null; setLoading(false); } }
  }
  useEffect(() => { if (open && !page.current.started && !reads.current && !loadError) void load(); }, [open]);

  async function submit(event) {
    event.preventDefault();
    if (write.current || !account) return;
    const text = draft.trim();
    if (!text || [...text].length > 1000) { setSubmitError('Write a comment of 1–1,000 characters.'); return; }
    const controller = write.current = new AbortController();
    setSending(true); setSubmitError(''); setNotice('');
    try {
      const result = await api.comment(post.id, text, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      updatePost(post.id, { commentCount: result.commentCount });
      if (page.current.started && !page.current.cursor) setComments(value => appendUnique(value, [result.comment]));
      else setRecent(value => appendUnique(value, [result.comment]));
      setDraft(value => value.trim() === text ? '' : value);
      setNotice('Your comment was posted.');
    } catch (error) {
      if (error.name !== 'AbortError' && mounted.current) setSubmitError(error.status ? error.message : 'Could not confirm your comment. Check the comments before sending it again.');
    } finally { if (mounted.current) { write.current = null; setSending(false); } }
  }
  return <section className="feed-comments" aria-label={`Comments on ${post.project.title}`} hidden={!open}>
    <h3>Conversation <span>{post.commentCount}</span></h3>
    {comments.length > 0 && <ol className="feed-comment-list">{comments.map(comment => <Comment key={comment.id} comment={comment} />)}</ol>}
    {started && !comments.length && !loading && <p className="feed-muted">No comments yet. Start the conversation.</p>}
    {loading && <p role="status" className="feed-muted">Loading comments…</p>}
    {loadError && <div className="feed-inline-error" role="alert"><p>{loadError}</p><button type="button" className="text-btn" onClick={load}>Retry loading comments</button></div>}
    {cursor && !loadError && <button type="button" className="feed-more-comments" disabled={loading} onClick={load}>Load more comments</button>}
    {recent.length > 0 && <div className="feed-recent"><p className="feed-muted">Your new comments</p><ol className="feed-comment-list">{recent.map(comment => <Comment key={comment.id} comment={comment} />)}</ol></div>}
    {account ? <form className="feed-comment-form" onSubmit={submit}>
      <label htmlFor={`draft-${post.id}`}>Add a comment</label>
      <textarea id={`draft-${post.id}`} value={draft} onChange={event => setDraft(event.target.value)} rows={3} disabled={sending} placeholder="Share a thought about this project…" aria-describedby={`comment-limit-${post.id}`} />
      <div className="feed-comment-submit"><span id={`comment-limit-${post.id}`} className="feed-muted">{[...draft].length}/1,000</span><button className="btn primary" type="submit" disabled={sending || !draft.trim() || [...draft.trim()].length > 1000}>{sending ? 'Posting…' : 'Post comment'}</button></div>
    </form> : <p className="feed-signin"><a href="#/signin">Sign in</a> to join the conversation.</p>}
    {submitError && <p role="alert" className="feed-inline-error">{submitError}</p>}
    <p className="feed-status" role="status">{notice}</p>
  </section>;
}
