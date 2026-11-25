import { parseTechStack } from '../../public/js/tech-stack.js';
import { useState } from 'react';
import { PostMedia } from './PostMedia.jsx';
import { LikeButton } from './LikeButton.jsx';
import { CommentSection } from './CommentSection.jsx';
import { FeedIcon } from './FeedIcon.jsx';

export function ProjectPost({ post, api, account, updatePost }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsVisited, setCommentsVisited] = useState(false);
  const showroomUrl = post.author.showroomId ? `#/showroom/${encodeURIComponent(post.author.showroomId)}` : null;
  const authorUrl = post.author.profileId
    ? `#/about/${encodeURIComponent(post.author.profileId)}${showroomUrl ? `?showroom=${encodeURIComponent(post.author.showroomId)}` : ''}`
    : showroomUrl;
  const projectUrl = showroomUrl ? `${showroomUrl}/${encodeURIComponent(post.project.id)}` : null;
  function toggleComments() { setCommentsVisited(true); setCommentsOpen(value => !value); }
  return <article className="feed-post" aria-labelledby={`post-title-${post.id}`} data-post-id={post.id}>
    <header className="feed-post-heading"><div><p className="feed-author">{authorUrl ? <a className="feed-name-link" href={authorUrl}>{post.author.name}</a> : post.author.name}</p><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div><span className="feed-type">{post.project.type === 'open' ? 'Open-source' : 'Closed-source'}</span></header>
    <PostMedia key={post.cover?.url} cover={post.cover} title={post.project.title} />
    <div className="feed-post-copy"><h2 id={`post-title-${post.id}`}>{projectUrl ? <a className="feed-name-link" href={projectUrl}>{post.project.title}</a> : post.project.title}</h2><p className="feed-description">{post.project.description}</p><ul className="tech-tags feed-stack" aria-label="Technologies">{parseTechStack(post.project.stack).map((technology, index) => <li className="tech-tag" key={`${index}-${technology}`}>{technology}</li>)}</ul></div>
    <div className="feed-post-actions"><LikeButton post={post} api={api} account={account} updatePost={updatePost} />
      <button type="button" className="feed-action" onClick={toggleComments} aria-expanded={commentsOpen} aria-controls={`comments-${post.id}`}><FeedIcon name="comment" /><span>{post.commentCount} <span className="feed-action-label">{post.commentCount === 1 ? 'comment' : 'comments'}</span></span></button>
    </div>
    <div id={`comments-${post.id}`} hidden={!commentsOpen}>{commentsVisited && <CommentSection key={`${post.id}-${account?.id ?? 'visitor'}`} post={post} api={api} account={account} updatePost={updatePost} open={commentsOpen} />}</div>
  </article>;
}
