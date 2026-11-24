import 'vite/modulepreload-polyfill';
import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { createFeedApi } from './feedApi.js';
import { FeedPage } from './FeedPage.jsx';
import './feed.css';

class FeedBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="feed-page"><h1>Could not open the feed.</h1><p role="alert">Something went wrong while displaying these projects.</p><button className="btn" type="button" onClick={() => this.setState({ failed: false })}>Try loading the feed again</button></section>;
    return this.props.children;
  }
}

export function mountFeed(container, { request, account }) {
  const root = createRoot(container);
  const api = createFeedApi(request);
  const render = account => root.render(<FeedBoundary><FeedPage api={api} account={account} /></FeedBoundary>);
  render(account);
  return { updateAccount: render, unmount: () => root.unmount() };
}
