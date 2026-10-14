'use client';

import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** Unfolds under the header menu. Double opt-in through /api/subscribe, as before. */
export default function SubscribePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [alreadySent, setAlreadySent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // After the unfold has started, so the focus ring doesn't flash at the old position.
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

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

  return (
    <div
      id="subscribe-panel"
      className="sub-panel"
      data-open={open}
      role="region"
      aria-label="Subscribe"
      inert={!open}
    >
      <p className="sub-title">New photos by email.</p>
      {status === 'sent' ? (
        <p className="sub-note" role="status">
          {alreadySent
            ? 'A confirmation link went to this address in the last hour. Check your inbox and spam, or try again later.'
            : "Check your inbox for a confirmation link. You won't get anything until you click it."}
        </p>
      ) : (
        <form className="sub-form" onSubmit={submit}>
          <input
            ref={inputRef}
            className="sub-input"
            type="email"
            required
            autoComplete="email"
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
            aria-hidden="true"
            className="sub-honeypot"
          />
          <button className="solid-btn" type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Subscribe'}
          </button>
        </form>
      )}
      {status === 'error' && (
        <p className="sub-error" role="alert">
          {error}
        </p>
      )}
      <p className="sub-note">
        At most once a week, only when there are new photos. Your address is kept by Resend and
        used for nothing else.
      </p>
    </div>
  );
}
