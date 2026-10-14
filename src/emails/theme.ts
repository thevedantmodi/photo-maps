import type { CSSProperties } from 'react';

// Light-theme subset of the Photo Maps design system (tokens.json in the design-system
// artifact), inlined because email clients ignore CSS variables and theme media queries.
export const EMAIL = {
  ground: '#f5f5f5', // admin-cardBg / loading-bg
  surface: '#ffffff', // background
  text: '#171717', // foreground
  muted: '#666666', // admin-captionText
  faint: '#999999', // admin-muted
  border: '#eeeeee', // admin-border
  button: '#171717', // foreground, as on the subscribe button
  buttonText: '#ffffff',
  font: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const s = {
  body: { backgroundColor: EMAIL.ground, fontFamily: EMAIL.font, margin: 0, padding: '24px 0' },
  container: {
    backgroundColor: EMAIL.surface,
    borderRadius: '10px', // radius-lg
    maxWidth: '560px',
    padding: '32px 28px',
  },
  brand: {
    color: EMAIL.faint,
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    margin: '0 0 24px',
    textTransform: 'uppercase',
  },
  h1: { color: EMAIL.text, fontSize: '22px', fontWeight: 600, lineHeight: '30px', margin: '0 0 12px' },
  text: { color: EMAIL.text, fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' },
  muted: { color: EMAIL.muted, fontSize: '13px', lineHeight: '20px', margin: '0 0 12px' },
  button: {
    backgroundColor: EMAIL.button,
    borderRadius: '30px', // radius-dock, the pill used for links over the map
    boxSizing: 'border-box',
    color: EMAIL.buttonText,
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: 500,
    padding: '12px 24px',
    textDecoration: 'none',
  },
  hr: { border: 'none', borderTop: `1px solid ${EMAIL.border}`, margin: '28px 0 20px' },
  footer: { color: EMAIL.faint, fontSize: '12px', lineHeight: '18px', margin: '0 0 6px' },
  link: { color: EMAIL.muted, textDecoration: 'underline' },
} satisfies Record<string, CSSProperties>;
