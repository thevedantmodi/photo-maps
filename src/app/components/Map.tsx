'use client';

import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../hooks/useTheme';

import DateFilter from './DateFilter';
import { Photo } from '../types';

interface MapProps {
    photos: Photo[];
}

const MapComponent = ({ photos }: MapProps) => {
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const [filteredPhotos, setFilteredPhotos] = useState<Photo[]>(photos);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const theme = useTheme();

    useEffect(() => {
        if (selectedYear === null) {
            setFilteredPhotos(photos);
            return;
        }

        const filtered = photos.filter(photo => {
            if (!photo.date) return false;
            const year = new Date(photo.date).getFullYear();
            return year === selectedYear;
        });
        setFilteredPhotos(filtered);
    }, [selectedYear, photos]);

    useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash.slice(1);
            if (hash) {
                let decodedHash = hash;
                try {
                    decodedHash = decodeURIComponent(hash);
                } catch (e) {
                    console.warn("Invalid hash encoding", e);
                }

                const photo = photos.find(p => p.friendly_name === decodedHash || p.id === decodedHash);
                if (photo) {
                    setSelectedPhoto(photo);
                } else {
                    setSelectedPhoto(null);
                }
            } else {
                setSelectedPhoto(null);
            }
        };

        window.addEventListener('hashchange', handleHashChange);
        // Check hash on mount
        handleHashChange();

        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [photos]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                window.location.hash = '';
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const createCustomIcon = (thumb_url: string) => {
        return L.divIcon({
            html: `<div class="photo-marker" style="background-image: url('${thumb_url}');"></div>`,
            className: 'custom-marker-icon',
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -24]
        });
    };

    const createClusterIcon = (cluster: any) => {
        const count = cluster.getChildCount();
        const markers = cluster.getAllChildMarkers();
        // Get up to 3 thumbnails from markers (we pass thumb url in title prop)
        const thumbs = markers.slice(0, 3).map((marker: any) => marker.options.title);

        let htmlContent = '';

        if (thumbs.length === 0) {
            // Fallback
            htmlContent = `<div style="width: 100%; height: 100%; background: var(--cluster-bg); border-radius: 50%;"></div>`;
        } else if (thumbs.length === 1) {
            htmlContent = `<div style="background-image: url('${thumbs[0]}'); width: 100%; height: 100%; background-size: cover; border-radius: 50%;"></div>`;
        } else {
            // Create a collage
            // We'll just overlay them slightly
            htmlContent = `<div style="position: relative; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: var(--cluster-bg);">`;
            thumbs.forEach((thumb: string, i: number) => {
                // Simple grid/stack logic
                // Better layout:
                // 2 images: split vertical
                // 3 images: 1 top, 2 bottom

                let style = '';
                if (thumbs.length === 2) {
                    style = `position: absolute; left: ${i * 50}%; top: 0; width: 50%; height: 100%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                } else {
                    // 3 images
                    if (i === 0) {
                        style = `position: absolute; left: 0; top: 0; width: 100%; height: 50%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                    } else {
                        style = `position: absolute; left: ${(i - 1) * 50}%; top: 50%; width: 50%; height: 50%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                    }
                }
                htmlContent += `<div style="${style}"></div>`;
            });
            htmlContent += `</div>`;
        }

        return L.divIcon({
            html: `<div class="cluster-marker-container">
        ${htmlContent}
        <div class="cluster-count-badge">${count}</div>
      </div>`,
            className: 'custom-cluster-icon',
            iconSize: [64, 64]
        });
    };

    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const tileLayerUrl = theme === 'dark'
        ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxToken}`
        : `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxToken}`;

    return (
        <>
            <MapContainer
                center={[20, 0]}
                zoom={2}
                style={{ height: '100vh', width: '100%', background: 'var(--map-background)' }}
                minZoom={2}
                worldCopyJump={true}
            >
                <TileLayer
                    url={tileLayerUrl}
                    attribution='&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://www.github.com/thevedantmodi/photo-maps">Source code</a>'
                    tileSize={512}
                    zoomOffset={-1}
                />

                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterIcon}
                    maxClusterRadius={60}
                    spiderfyOnMaxZoom={true}
                    showCoverageOnHover={false}
                >
                    {filteredPhotos.map((photo) => (
                        <Marker
                            key={photo.id}
                            position={[photo.lat ?? 0, photo.lon ?? 0]}
                            icon={createCustomIcon(photo.thumb_url)}
                            title={photo.thumb_url}
                            eventHandlers={{
                                click: () => {
                                    window.location.hash = photo.friendly_name;
                                },
                            }}
                        />
                    ))}
                </MarkerClusterGroup>
            </MapContainer>

            <DateFilter
                photos={photos}
                selectedYear={selectedYear}
                onYearChange={setSelectedYear}
            />

            <AnimatePresence>
                {selectedPhoto && (
                    <motion.div
                        className="modal-overlay"
                        onClick={() => window.location.hash = ''}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <motion.div
                            className="modal-content"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <img
                                src={selectedPhoto.large_url}
                                alt="Full size"
                                style={{
                                    maxWidth: 'calc(100vw - 40px)',
                                    maxHeight: '65dvh',
                                    width: 'auto',
                                    height: 'auto',
                                    display: 'block',
                                    margin: '0 auto',
                                    borderRadius: '4px',
                                    boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                                }}
                            />
                            <button
                                className="modal-close-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.location.hash = '';
                                }}
                            >
                                &times;
                            </button>
                        </motion.div>
                        <motion.div
                            className="modal-caption"
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            transition={{ duration: 0.2, delay: 0.1 }}
                        >
                            {selectedPhoto.caption || selectedPhoto.original_name}
                            {selectedPhoto.date && (
                                <div style={{ fontSize: '0.8em', opacity: 0.8, marginTop: '4px' }}>
                                    {new Date(selectedPhoto.date).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default MapComponent;
