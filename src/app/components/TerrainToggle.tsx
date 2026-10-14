'use client';

interface TerrainToggleProps {
    enabled: boolean;
    onToggle: () => void;
    hidden?: boolean;
}

export default function TerrainToggle({ enabled, onToggle, hidden }: TerrainToggleProps) {
    return (
        <button
            className={`terrain-toggle${enabled ? ' terrain-toggle-on' : ''}${hidden ? ' icon-btn-hidden' : ''}`}
            onClick={onToggle}
            aria-label="3D terrain"
            aria-pressed={enabled}
            aria-hidden={hidden}
            tabIndex={hidden ? -1 : 0}
            title={enabled ? 'Turn off 3D terrain' : 'Turn on 3D terrain'}
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M3 20l6.5-11 4 6.5L16 12l5 8z" />
                <path d="M7.6 12.2l1.9 1.3 1.6-1.2" />
            </svg>
        </button>
    );
}
