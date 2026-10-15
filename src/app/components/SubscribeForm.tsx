'use client';

import { forwardRef, useState } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Email signup: double opt-in through /api/subscribe. Shared by the header's subscribe
 * panel and the /subscribe page, so both send, confirm and fail the same way.
 */
const SubscribeForm = forwardRef<HTMLInputElement>(function SubscribeForm(_, inputRef) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [alreadySent, setAlreadySent] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    setError('');
    const website = new FormData(e.currentTarget).get('website');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Something went wrong, try again');
      setAlreadySent(Boolean(body?.alreadySent));
      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong, try again');
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <p className="sub-note" role="status">
        {alreadySent
          ? 'A confirmation link went to this address in the last hour. Check your inbox and spam, or try again later.'
          : "Check your inbox for a confirmation link. You won't get anything until you click it."}
      </p>
    );
  }

  return (
    <>
      {/* An email box next to a hidden text field reads as a sign-in form to password
          managers, which then offer to fill it. Autocomplete off, plus each manager's own
          opt-out (1Password, LastPass, Bitwarden, Dashlane), keeps them out. */}
      <form className="sub-form" onSubmit={submit} autoComplete="off" data-form-type="other">
        <input
          ref={inputRef}
          className="sub-input"
          type="email"
          name="subscribe-email"
          required
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          placeholder="you@example.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {/* Honeypot, hidden from people and screen readers. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          aria-hidden="true"
          className="sub-honeypot"
        />
        <button className="solid-btn" type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Subscribe'}
        </button>
      </form>
      {status === 'error' && (
        <p className="sub-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
});

export default SubscribeForm;
