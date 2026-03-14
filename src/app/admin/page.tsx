// app/admin/page.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';

interface PhotoEntry {
    file: File;
    caption: string;
    preview: string;
    status: 'ready' | 'uploading' | 'done' | 'error';
    error?: string;
}

export default function AdminPage() {
    const [photos, setPhotos] = useState<PhotoEntry[]>([]);
    const [dragging, setDragging] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (photos.length === 0) return;
            if (document.activeElement?.tagName === 'INPUT') return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelected(prev => prev === null ? 0 : Math.min(prev + 1, photos.length - 1));
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected(prev => prev === null ? 0 : Math.max(prev - 1, 0));
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [photos.length]);

    const addFiles = useCallback((files: FileList) => {
        const entries: PhotoEntry[] = Array.from(files).map(file => {
            const preview = URL.createObjectURL(file);
            return { file, caption: '', preview, status: 'ready' };
        });
        setPhotos(prev => [...prev, ...entries]);
    }, []);

    const remove = (i: number) => {
        setPhotos(prev => {
            URL.revokeObjectURL(prev[i].preview);
            return prev.filter((_, j) => j !== i);
        });
        setSelected(null);
    };

    const setCaption = (i: number, caption: string) => {
        setPhotos(prev => prev.map((p, j) => j === i ? { ...p, caption } : p));
    };

    const uploadAll = async () => {
        await Promise.all(
            photos.map(async (p, i) => {
                if (p.status !== 'ready') return;

                setPhotos(prev => prev.map((x, j) => j === i ? { ...x, status: 'uploading' } : x));

                const fd = new FormData();
                fd.append('file', p.file);
                fd.append('caption', p.caption);

                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: fd });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error ?? 'Upload failed');
                    setPhotos(prev => prev.map((x, j) => j === i ? { ...x, status: 'done' } : x));
                } catch (e: any) {
                    setPhotos(prev => prev.map((x, j) => j === i ? { ...x, status: 'error', error: e.message } : x));
                }
            })
        );
    };

    const ready = photos.filter(p => p.status === 'ready').length;

    return (
        <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Upload photos</h1>
                    <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                        {photos.length} photo{photos.length !== 1 ? 's' : ''} — {ready} ready
                    </p>
                </div>
                <button onClick={uploadAll} disabled={ready === 0}>
                    Upload {ready > 0 ? `${ready} ` : ''}photo{ready !== 1 ? 's' : ''}
                </button>
            </div>

            <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={e => {
                    const related = e.relatedTarget as Node | null;
                    if (!related || !e.currentTarget.contains(related)) {
                        setDragging(false);
                    }
                }}
                onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                }}
                onClick={() => document.getElementById('file-input')?.click()}
                style={{
                    border: `1.5px dashed ${dragging ? 'var(--color-border-primary)' : 'var(--color-border-secondary)'}`,
                    borderRadius: 12,
                    padding: '2rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    marginBottom: '1.5rem',
                    background: dragging ? 'var(--color-background-secondary)' : 'transparent',
                    transition: 'background 0.15s, border-color 0.15s',
                }}
            >
                <p style={{ margin: 0, fontWeight: 500 }}>Drop photos here</p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    or click to browse
                </p>
                <input
                    id="file-input"
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => e.target.files && addFiles(e.target.files)}
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {photos.map((p, i) => (
                    <div
                        key={i}
                        onClick={() => setSelected(i)}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '120px 1fr auto',
                            gap: 12,
                            alignItems: 'center',
                            padding: 12,
                            borderRadius: 8,
                            border: selected === i
                                ? '1.5px solid var(--color-border-primary)'
                                : '0.5px solid var(--color-border-tertiary)',
                            background: selected === i
                                ? 'var(--color-background-secondary)'
                                : 'var(--color-background-primary)',
                            cursor: 'pointer',
                            transition: 'background 0.1s, border-color 0.1s',
                        }}
                    >
                        <img
                            src={p.preview}
                            alt={p.file.name}
                            style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6 }}
                        />
                        <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.file.name}
                                </span>
                                <span style={{
                                    fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                                    background: p.status === 'done' ? 'var(--color-background-success)' :
                                        p.status === 'error' ? 'var(--color-background-danger)' :
                                            p.status === 'uploading' ? 'var(--color-background-warning)' :
                                                'var(--color-background-secondary)',
                                    color: p.status === 'done' ? 'var(--color-text-success)' :
                                        p.status === 'error' ? 'var(--color-text-danger)' :
                                            p.status === 'uploading' ? 'var(--color-text-warning)' :
                                                'var(--color-text-secondary)',
                                }}>
                                    {p.status === 'error' ? p.error : p.status}
                                </span>
                            </div>
                            <input
                                type="text"
                                placeholder="Add a caption…"
                                value={p.caption}
                                onChange={e => setCaption(i, e.target.value)}
                                disabled={p.status !== 'ready'}
                                onClick={e => e.stopPropagation()}
                                style={{ width: '100%', boxSizing: 'border-box', fontSize: 13 }}
                            />
                        </div>
                        <button
                            onClick={e => { e.stopPropagation(); remove(i); }}
                            disabled={p.status === 'uploading'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '4px 8px', color: 'var(--color-text-secondary)' }}
                        >
                            ×
                        </button>
                    </div>
                ))}
                {photos.length === 0 && (
                    <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)', padding: '1rem 0' }}>
                        No photos yet — drop some above
                    </p>
                )}
            </div>
        </main>
    );
}
