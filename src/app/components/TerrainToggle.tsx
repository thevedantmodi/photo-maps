'use client';

interface TerrainToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** A short note under the switch, e.g. that the relief needs a closer zoom. */
  note?: string | null;
  className?: string;
}

/** 2D | 3D, set like Light | Dark: the current one is bold. The map tilts in Map.tsx. */
export default function TerrainToggle({ enabled, onChange, note, className }: TerrainToggleProps) {
  return (
    <div
      role="group"
      aria-label="Terrain"
      className={['theme-switch', 'terrain-switch', className].filter(Boolean).join(' ')}
    >
      <button type="button" className="text-btn" aria-pressed={!enabled} onClick={() => onChange(false)}>
        2D
      </button>
      <span className="sep" aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className="text-btn"
        aria-pressed={enabled}
        title="3D terrain: relief, and a tilt once you zoom in"
        onClick={() => onChange(true)}
      >
        3D
      </button>
      <span className="terrain-note" role="status" data-in={Boolean(note)}>
        {note}
      </span>
    </div>
  );
}
