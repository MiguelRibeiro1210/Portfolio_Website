import { useEffect, useRef } from 'react';
import { useFeed } from './useFeed.js';
import { SearchSuggestions } from './SearchSuggestions.jsx';
import { ProjectPost } from './ProjectPost.jsx';
import { FeedIcon } from './FeedIcon.jsx';

export function FeedPage({ api, account }) {
  const feed = useFeed(api, account);
  const sentinel = useRef(null);
  const posts = feed.posts;
  useEffect(() => {
    if (!sentinel.current || !feed.nextCursor || feed.loading || feed.error || !globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void feed.loadMore(); }, { rootMargin: '0px 0px 600px 0px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [feed.nextCursor, feed.loading, feed.error, feed.loadMore]);
  return <div className="feed-page">
    <header className="feed-intro"><p className="eyebrow">THE DISCOVERY FEED</p><h1>Discover what’s<br />being built<span>.</span></h1><p>Fresh projects. Different perspectives. Good work, shared.</p></header>
    <section className="feed-layout" aria-label="Project feed">
      <aside className="feed-sidebar"><h2>A little curiosity<br />goes a long way.</h2><p>Explore the work behind the ideas. Find something that inspires your next project.</p><a className="btn primary" href={account ? '#/studio' : '#/register'}>{account ? 'Share a project' : 'Create your account'} <FeedIcon name="arrow" /></a><p className="feed-sidebar-note">Made by people.<br />Built to be seen.</p></aside>
      <div className="feed-stream">
        <SearchSuggestions api={api} />
        <div className="feed-stream-heading"><h2>Latest projects</h2><span>Newest first</span></div>
        {posts.map(post => <ProjectPost key={post.id} post={post} api={api} account={account} updatePost={feed.updatePost} />)}
        {feed.started && !feed.posts.length && !feed.error && <div className="feed-empty"><p className="eyebrow">A SPACE FOR WHAT’S NEXT</p><h2>No published projects yet.</h2><p>Every great collection starts with one idea. Yours could be the first.</p><a href={account ? '#/studio' : '#/signin'} className="btn primary">{account ? 'Add your first project' : 'Sign in to share a project'}</a></div>}
        {feed.error && <div className="feed-load-error" role="alert"><p>{feed.error}</p><button type="button" className="btn" onClick={feed.retry} disabled={feed.loading}>Retry loading projects</button></div>}
        <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />
        <div className="feed-pagination" aria-live="polite">
          {feed.loading && <p role="status">Loading projects…</p>}
          {feed.nextCursor && !feed.error && <button className="btn" type="button" onClick={feed.loadMore} disabled={feed.loading}>Load more projects</button>}
          {feed.started && feed.posts.length > 0 && !feed.nextCursor && !feed.loading && !feed.error && <p>You’re all caught up.</p>}
        </div>
      </div>
    </section>
  </div>;
}
