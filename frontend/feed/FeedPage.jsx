import { useEffect, useRef, useState } from 'react';
import { useFeed } from './useFeed.js';
import { matchesSearch } from './feedApi.js';
import { ProjectPost } from './ProjectPost.jsx';
import { FeedIcon } from './FeedIcon.jsx';

export function FeedPage({ api, account }) {
  const feed = useFeed(api, account);
  const [query, setQuery] = useState('');
  const sentinel = useRef(null);
  const searching = Boolean(query.trim());
  const posts = feed.posts.filter(post => matchesSearch(post, query));
  useEffect(() => {
    if (!sentinel.current || !feed.nextCursor || feed.loading || feed.error || searching || !globalThis.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void feed.loadMore(); }, { rootMargin: '0px 0px 600px 0px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [feed.nextCursor, feed.loading, feed.error, feed.loadMore, searching]);
  return <div className="feed-page">
    <header className="feed-intro"><p className="eyebrow">THE DISCOVERY FEED</p><h1>Discover what’s<br />being built<span>.</span></h1><p>Fresh projects. Different perspectives. Good work, shared.</p></header>
    <section className="feed-layout" aria-label="Project feed">
      <aside className="feed-sidebar"><h2>A little curiosity<br />goes a long way.</h2><p>Explore the work behind the ideas. Find something that inspires your next project.</p><a className="btn primary" href={account ? '#/studio' : '#/register'}>{account ? 'Share a project' : 'Create your account'} <FeedIcon name="arrow" /></a><p className="feed-sidebar-note">Made by people.<br />Built to be seen.</p></aside>
      <div className="feed-stream">
        <form className="feed-search" role="search" onSubmit={event => event.preventDefault()}>
          <label htmlFor="feed-search">Search projects or creators</label><div className="feed-search-input"><FeedIcon name="search" /><input id="feed-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a project or a person…" aria-describedby="feed-search-help" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><FeedIcon name="close" /></button>}</div>
          <p id="feed-search-help" className="feed-muted">Searches projects and creators loaded in this feed.{searching && feed.nextCursor ? ' Load more to search further.' : ''}</p>
        </form>
        <div className="feed-stream-heading"><h2>{searching ? 'Search results' : 'Latest projects'}</h2><span>{searching ? `${posts.length} ${posts.length === 1 ? 'match' : 'matches'}` : 'Newest first'}</span></div>
        {posts.map(post => <ProjectPost key={post.id} post={post} api={api} account={account} updatePost={feed.updatePost} />)}
        {feed.started && !feed.posts.length && !feed.error && <div className="feed-empty"><p className="eyebrow">A SPACE FOR WHAT’S NEXT</p><h2>No published projects yet.</h2><p>Every great collection starts with one idea. Yours could be the first.</p><a href={account ? '#/studio' : '#/signin'} className="btn primary">{account ? 'Add your first project' : 'Sign in to share a project'}</a></div>}
        {searching && feed.posts.length > 0 && !posts.length && <div className="feed-empty" role="status"><h2>No matches in loaded projects.</h2><p>Try another project or creator name{feed.nextCursor ? ', or load more projects below.' : '.'}</p><button type="button" className="text-btn" onClick={() => setQuery('')}>Clear search</button></div>}
        {feed.error && <div className="feed-load-error" role="alert"><p>{feed.error}</p><button type="button" className="btn" onClick={feed.retry} disabled={feed.loading}>Retry loading projects</button></div>}
        <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />
        <div className="feed-pagination" aria-live="polite">
          {feed.loading && <p role="status">Loading projects…</p>}
          {feed.nextCursor && !feed.error && <button className="btn" type="button" onClick={feed.loadMore} disabled={feed.loading}>{searching ? 'Load more projects to search' : 'Load more projects'}</button>}
          {feed.started && feed.posts.length > 0 && !feed.nextCursor && !feed.loading && !feed.error && <p>You’re all caught up.</p>}
        </div>
      </div>
    </section>
  </div>;
}
