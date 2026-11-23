import { field, icon, link, button } from './ui.js';

export function authPage(mode = 'signin', status = '') {
  const register = mode === 'register';
  const reset = mode === 'reset';
  const heading = register ? 'Create an account.' : reset ? 'Reset your password.' : 'Welcome back.';
  const description = register ? 'Give your work a place to live.'
    : reset ? 'Enter the email associated with your account.' : 'Your next chapter starts in your studio.';

  return `<div class="auth-layout section-pad">
    <section class="auth-art">
      <p class="eyebrow">A home for your work</p>
      <span class="wordmark">folio</span>
      <h2>You built it.<br>Now show it.</h2>
      <div class="auth-art-message">
        <p class="eyebrow">One profile. All your potential.</p>
        <p>Made for developers, students, and the things they’re making next.</p>
      </div>
    </section>
    <section class="auth-form-wrap"><div class="auth-form-inner">
      <h1>${heading}</h1>
      <p>${description}</p>
      ${reset ? '<p class="fine-print">Password reset is coming soon.</p>' : `<div class="auth-providers">
        ${link('Continue with Google', '/api/oauth/google/start', 'full')}
        ${link('Continue with GitHub', '/api/oauth/github/start', 'full')}
      </div><div class="or-divider"><span>Or with email</span></div>`}
      <form id="auth-form" data-mode="${mode}">
        ${register ? field('Your name', 'name', '', 'Your name', 'text', true) : ''}
        ${field('Email address', 'email', '', 'you@example.com', 'email', true)}
        ${reset ? '' : `<label class="password-label" for="password">Password</label>
        <div class="password-field"><input aria-label="Password" name="password" id="password" type="password"
          placeholder="${register ? 'Create a password (at least 8 characters)' : 'Enter your password'}"
          required minlength="${register ? 8 : 1}" autocomplete="${register ? 'new-password' : 'current-password'}">
          <button type="button" data-action="toggle-password" aria-controls="password" aria-pressed="false">Show</button></div>`}
        <button type="submit" class="btn primary full">${register ? 'Create account' : reset ? 'Request reset link' : 'Sign in'} ${icon('arrow')}</button>
        <p id="auth-feedback" class="form-feedback" role="status">${status}</p>
      </form>
      <div class="auth-legal fine-print">By continuing, you agree to our
        ${button('Terms of use', 'terms', 'text-btn')} and ${button('Privacy Policy', 'privacy', 'text-btn')}.
      </div>
      ${register || reset ? '<p class="auth-switch"><a href="#/signin">Back to sign in ↗</a></p>' : ''}
    </div></section>
  </div>`;
}
