'use client';

interface TerrainToggleProps {
  enabled: boolean;
  onToggle: () => void;
  className?: string;
}

/** A word, underlined while 3D terrain is on. The map tilts in Map.tsx. */
export default function TerrainToggle({ enabled, onToggle, className }: TerrainToggleProps) {
  return (
    <button
      type="button"
      className={className ? `text-btn ul ${className}` : 'text-btn ul'}
      onClick={onToggle}
      aria-pressed={enabled}
      title={enabled ? 'Turn off 3D terrain' : 'Turn on 3D terrain'}
    >
      3D terrain
    </button>
  );
}
