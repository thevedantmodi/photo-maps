'use client';

import { useTheme } from '../hooks/useTheme';

/**
 * Light | Dark. The current option is bolded by CSS from <html data-theme>, so the
 * server render and the first client render match before the store has a value.
 */
export default function ThemeSwitch({ className }: { className?: string }) {
  const [theme, , setTheme] = useTheme();

  return (
    <div role="group" aria-label="Theme" className={className ? `theme-switch ${className}` : 'theme-switch'}>
      <button
        type="button"
        className="text-btn"
        data-option="light"
        aria-pressed={theme === 'light'}
        onClick={() => setTheme('light')}
      >
        Light
      </button>
      <span className="sep" aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className="text-btn"
        data-option="dark"
        aria-pressed={theme === 'dark'}
        onClick={() => setTheme('dark')}
      >
        Dark
      </button>
    </div>
  );
}
