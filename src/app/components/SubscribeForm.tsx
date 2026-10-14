'use client';

import { useEffect, useRef, useState } from 'react';

interface SubscribeFormProps {
    autoFocus?: boolean;
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function SubscribeForm({ autoFocus }: SubscribeFormProps) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState('');
    const [alreadySent, setAlreadySent] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

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
            <p className="subscribe-note" role="status">
                {alreadySent
                    ? 'We sent a confirmation link to this address in the last hour. Check your inbox and spam, or try again later.'
                    : "Check your inbox for a confirmation link. You won't get anything until you click it."}
            </p>
        );
    }

    return (
        <>
            <form className="subscribe-form" onSubmit={submit}>
                <input
                    ref={inputRef}
                    className="subscribe-input"
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
                    className="subscribe-honeypot"
                />
                <button className="subscribe-submit" type="submit" disabled={status === 'sending'}>
                    {status === 'sending' ? 'Sending…' : 'Subscribe'}
                </button>
            </form>
            {status === 'error' && (
                <p className="subscribe-error" role="alert">
                    {error}
                </p>
            )}
        </>
    );
}
