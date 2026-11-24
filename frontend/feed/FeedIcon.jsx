import { icon } from '../../public/js/ui.js';

export function FeedIcon({ name }) {
  return <span className="feed-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon(name, 18) }} />;
}
