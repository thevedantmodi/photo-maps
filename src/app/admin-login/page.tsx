'use client';

import { useState } from 'react';

// Sign-in for the installed admin app: iOS home-screen apps can't show the browser's Basic
// Auth prompt, so proxy.ts sends signed-out visits here. The path starts with /admin so it
// stays inside the admin app's scope.
export default function AdminLogin() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: form.get('user'), pass: form.get('pass') }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.replace('/admin');
      return;
    }
    setBusy(false);
    setError(res ? 'Wrong username or password' : 'Could not reach the server');
  }

  const field = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 6,
    padding: '10px 12px',
    font: 'inherit',
    fontSize: 16,
    color: 'var(--ink)',
    background: 'transparent',
    border: '1px solid var(--ink)',
    borderRadius: 0,
  } as const;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 320, display: 'grid', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Admin</h1>
        <label>
          Username
          <input name="user" autoComplete="username" autoCapitalize="none" required style={field} />
        </label>
        <label>
          Password
          <input name="pass" type="password" autoComplete="current-password" required style={field} />
        </label>
        {error && <p role="alert" style={{ margin: 0, color: '#b42318' }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{ ...field, marginTop: 0, cursor: 'pointer', color: 'var(--bg)', background: 'var(--ink)' }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
