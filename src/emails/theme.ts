import type { CSSProperties } from 'react';

// The light theme of the site (--bg, --ink, --muted, --rule in globals.css), inlined
// because email clients ignore CSS variables and theme media queries.
export const EMAIL = {
  ground: '#ededeb', // --bg
  surface: '#fafaf7',
  text: '#141414', // --ink
  muted: '#636361', // --muted
  rule: '#141414', // --ink: rows are ruled in ink, as on the site
  button: '#141414',
  buttonText: '#fafaf7',
  font: "'Neue Haas Grotesk Text', 'Helvetica Neue', Helvetica, Geist, Arial, sans-serif",
} as const;

export const s = {
  body: { backgroundColor: EMAIL.ground, fontFamily: EMAIL.font, margin: 0, padding: '24px 0' },
  container: {
    backgroundColor: EMAIL.surface,
    maxWidth: '560px',
    padding: '32px 28px',
  },
  brand: {
    color: EMAIL.text,
    fontSize: '15px',
    fontWeight: 700,
    letterSpacing: '-0.01em',
    margin: '0 0 24px',
    paddingBottom: '16px',
    borderBottom: `1px solid ${EMAIL.rule}`,
  },
  h1: {
    color: EMAIL.text,
    fontSize: '30px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: '32px',
    margin: '0 0 16px',
  },
  text: { color: EMAIL.text, fontSize: '15px', lineHeight: '22px', margin: '0 0 16px' },
  muted: { color: EMAIL.muted, fontSize: '13px', lineHeight: '20px', margin: '0 0 12px' },
  button: {
    backgroundColor: EMAIL.button,
    boxSizing: 'border-box',
    color: EMAIL.buttonText,
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: 700,
    padding: '12px 20px',
    textDecoration: 'none',
  },
  hr: { border: 'none', borderTop: `1px solid ${EMAIL.rule}`, margin: '28px 0 16px' },
  footer: { color: EMAIL.muted, fontSize: '12px', lineHeight: '18px', margin: '0 0 6px' },
  link: { color: EMAIL.text, textDecoration: 'underline' },
} satisfies Record<string, CSSProperties>;
