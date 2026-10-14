/** The V: one line from corner to corner, the mark beside the name and the loader. */
export default function VMark({
  width = 24,
  strokeWidth = 1.6,
  className,
}: {
  width?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `vmark ${className}` : 'vmark'}
      width={width}
      height={Math.round((width * 18) / 26)}
      viewBox="0 0 26 18"
      aria-hidden="true"
    >
      <polyline points="0.5,0.5 13,17 25.5,0.5" pathLength={1} strokeWidth={strokeWidth} />
    </svg>
  );
}
