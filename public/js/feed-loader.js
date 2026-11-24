let bundle;
let attempt = 0;
const styles = new Map();
async function stylesheet(href) {
  if (!styles.has(href)) {
    styles.set(href, new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.onload = resolve;
      link.onerror = () => { link.remove(); styles.delete(href); reject(new Error('Could not load feed styles.')); };
      document.head.append(link);
    }));
  }
  return styles.get(href);
}

export function loadFeedBundle() {
  if (!bundle) bundle = (async () => {
    const response = await fetch('/feed-assets/manifest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Could not load the feed. Please try again.');
    const manifest = await response.json();
    const entry = Object.values(manifest).find(item => item.isEntry);
    if (!entry?.file) throw new Error('The feed is temporarily unavailable.');
    await Promise.all((entry.css ?? []).map(file => stylesheet(`/feed-assets/${file}`)));
    const retry = attempt++;
    return import(`/feed-assets/${entry.file}${retry ? `?retry=${retry}` : ''}`);
  })().catch(error => { bundle = undefined; throw error; });
  return bundle;
}
