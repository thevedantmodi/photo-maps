/** The feed mark: a dot and two arcs, drawn in the text colour at the text's size. */
export default function RssIcon() {
  return (
    <svg className="rss-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="3" cy="13" r="1.6" fill="currentColor" />
      <path d="M2 7.5a6.5 6.5 0 0 1 6.5 6.5M2 2.5A11.5 11.5 0 0 1 13.5 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
