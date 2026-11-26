import { useEffect, useRef, useState } from 'react';
import { FeedIcon } from './FeedIcon.jsx';
import { suggestionUrl } from './feedApi.js';

export function SearchSuggestions({ api }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState({ status: 'idle', suggestions: [] });
  const active = useRef({ generation: 0, query: '', result: null, pending: null, timer: null, controller: null });
  const input = useRef(null);
  const list = useRef(null);
  function cancel() {
    const state = active.current;
    clearTimeout(state.timer);
    state.controller?.abort();
    state.generation++;
    state.pending = null;
    state.result = null;
  }
  useEffect(() => () => cancel(), []);
  function request() {
    const state = active.current;
    if (state.pending) return state.pending;
    const { generation, query: q } = state;
    const controller = new AbortController();
    state.controller = controller;
    setResult({ status: 'loading', suggestions: [] });
    const pending = api.suggestions(q, controller.signal).then(data => {
      if (controller.signal.aborted || generation !== state.generation) return null;
      state.result = data;
      setResult({ status: 'ready', ...data });
      return data;
    }).catch(error => {
      if (!controller.signal.aborted && generation === state.generation) {
        setResult({ status: 'error', suggestions: [], message: error.message || 'Search is unavailable. Please try again.' });
      }
      return null;
    }).finally(() => {
      if (state.pending === pending) state.pending = null;
    });
    state.pending = pending;
    return pending;
  }
  function change(value) {
    cancel();
    setQuery(value);
    active.current.query = value.trim();
    const searchable = [...value.trim()].length >= 2;
    setOpen(searchable);
    setResult({ status: searchable ? 'loading' : 'idle', suggestions: [] });
    if (searchable) active.current.timer = setTimeout(request, 250);
  }
  async function submit(event) {
    event.preventDefault();
    const state = active.current;
    if ([...state.query].length < 2) return;
    const generation = state.generation;
    clearTimeout(state.timer);
    setOpen(true);
    const data = state.result || await request();
    if (generation === state.generation && data?.suggestions.length) {
      location.hash = suggestionUrl(data.suggestions[0]);
    }
  }
  const visible = open && [...query.trim()].length >= 2;
  return <form className="feed-search" role="search" onSubmit={submit} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor="feed-search">Search projects or creators</label>
    <div className="feed-search-input"><FeedIcon name="search" />
      <input ref={input} id="feed-search" type="search" role="combobox" autoComplete="off" maxLength={200}
        value={query} onChange={event => change(event.target.value)} placeholder="Find a project or a person…"
        aria-describedby="feed-search-help" aria-expanded={visible} aria-controls="search-suggestions" aria-autocomplete="list"
        onFocus={() => { if ([...query.trim()].length >= 2) setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { cancel(); setOpen(false); setResult({ status: 'idle', suggestions: [] }); }
          if (event.key === 'ArrowDown' && visible) { event.preventDefault(); list.current?.querySelector('a')?.focus(); }
        }} />
      {query && <button type="button" onClick={() => { change(''); input.current?.focus(); }} aria-label="Clear search"><FeedIcon name="close" /></button>}
    </div>
    <p id="feed-search-help" className="feed-muted">Search all users and published projects by name. Enter opens the first match.</p>
    {visible && <div className="search-dropdown">
      <p role="status" className="feed-muted">
        {result.status === 'loading' ? 'Searching…' : result.status === 'ready' ? result.suggestions.length ? 'Matching users and projects' : 'No matching users or projects.' : ''}
      </p>
      {result.status === 'error' && <div role="alert"><p>{result.message}</p><button type="button" className="text-btn" onClick={() => void request()}>Retry search</button></div>}
      <ul ref={list} id="search-suggestions" role="listbox" aria-label="Search suggestions" onKeyDown={event => {
        if (event.key === 'Escape') { input.current?.focus(); setOpen(false); }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        const links = [...list.current.querySelectorAll('a')];
        const index = links.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
        if (index < 0) input.current?.focus();
        else links[Math.min(index, links.length - 1)]?.focus();
      }}>
        {result.suggestions.map(item => <li key={item.type + item.id} role="presentation"><a role="option" aria-selected="false" href={suggestionUrl(item)}>
          <strong>{item.label}</strong><span>{item.type === 'user' ? `User · ${item.accountName}` : `Project · ${item.creatorName}`}</span>{item.type === 'user' && <span className="search-user-email">{item.email}</span>}
        </a></li>)}
      </ul>
      {result.hasMore && <p className="feed-muted">More matches available. Refine your search to narrow the suggestions.</p>}
    </div>}
  </form>;
}
