(() => {
  const storageKey = 'folio-theme';
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');

  function applyTheme(dark) {
    root.dataset.theme = dark ? 'dark' : 'light';
    themeColor.content = dark ? '#151719' : '#f5f5f2';
  }

  try {
    applyTheme(localStorage.getItem(storageKey) === 'dark');
  } catch {
    applyTheme(false);
  }

  document.addEventListener('change', event => {
    if (event.target.id !== 'dark-theme') return;
    const dark = event.target.checked;
    applyTheme(dark);
    try {
      localStorage.setItem(storageKey, root.dataset.theme);
    } catch {
      // The theme still applies for the current page if storage is unavailable.
    }
  });
})();
