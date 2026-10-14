/**
 * The mark: a printer's registration mark, the circle and crosshair used to line up an
 * art book's plates — and, on a map, "here". Beside the name, as the loader, and on the
 * share card.
 */
export default function Mark({
  size = 22,
  strokeWidth = 1.4,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `mark ${className}` : 'mark'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="6.5" pathLength={1} strokeWidth={strokeWidth} />
      <line x1="12" y1="0.5" x2="12" y2="23.5" pathLength={1} strokeWidth={strokeWidth} />
      <line x1="0.5" y1="12" x2="23.5" y2="12" pathLength={1} strokeWidth={strokeWidth} />
    </svg>
  );
}
