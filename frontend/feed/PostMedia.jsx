import { useState } from 'react';

export function PostMedia({ cover, title }) {
  const [failed, setFailed] = useState(false);
  return <div className="feed-media">
    {!cover || failed ? <div className="feed-media-missing"><span aria-hidden="true">[ image ]</span><p>Project media is unavailable.</p></div>
      : cover.type.startsWith('video/') ? <video controls preload="none" aria-label={`${title} video`} src={cover.url} onError={() => setFailed(true)} />
      : <img src={cover.url} alt={`${title} — ${cover.name}`} loading="lazy" decoding="async" onError={() => setFailed(true)} />}
  </div>;
}
