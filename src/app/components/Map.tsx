"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Map, { Marker } from "react-map-gl/mapbox";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/mapbox";
import useSupercluster from "use-supercluster";
import "mapbox-gl/dist/mapbox-gl.css";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "../hooks/useTheme";
import { MAP_STYLES } from "@/lib/mapStyles";

import DateFilter from "./DateFilter";
import ShareButton from "./ShareButton";
import { shareVersion } from "@/lib/shareVersion";
import ThemeToggle from "./ThemeToggle";
import LocationSidebar from "./LocationSidebar";
import SearchBox from "./SearchBox";
import { PlaceSuggestion } from "@/lib/mapboxGeocode";
import { Photo } from "../types";

/**
 * supercluster returns either an original point (carrying its photo) or a generated
 * cluster (carrying a count), sharing one properties bag.
 */
type ClusterProps = {
  cluster: boolean;
  point_count?: number;
  photo?: Photo;
};

interface MapProps {
  photos: Photo[];
}

const MapComponent = ({ photos }: MapProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [viewState, setViewState] = useState({
    longitude: -96.40442327908295,
    latitude: 39.206117736168125,
    zoom: 2,
  });
  const [bounds, setBounds] = useState<[number, number, number, number]>([
    -180, -85, 180, 85,
  ]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const [theme, toggleTheme] = useTheme();

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
        const photo = photos.find(
          (p) => p.friendly_name === decodedHash || p.id === decodedHash,
        );
        setImgLoaded(false);
        setSelectedPhoto(photo ?? null);
      } else {
        setSelectedPhoto(null);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [photos]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.location.hash = "";
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const updateBounds = useCallback(() => {
    if (mapRef.current) {
      const b = mapRef.current.getBounds()!;
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    }
  }, []);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current.getMap();
    if (theme === "dark") {
      map.setFog({
        "star-intensity": 0.8,
        color: "rgb(8, 8, 28)",
        "high-color": "#000010",
        "horizon-blend": 0.02,
        "space-color": "#000005",
      });
    } else {
      map.setFog({
        "star-intensity": 0.8,
        color: "rgb(8, 8, 28)",
        "high-color": "#000010",
        "horizon-blend": 0.02,
        "space-color": "#000005",
      });
    }
  }, [theme, mapLoaded]);

  const onMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);
      updateBounds();
    },
    [updateBounds],
  );

  // Shared navigation used by both the location sidebar and the search box.
  const flyTo = useCallback(
    (longitude: number, latitude: number, zoom = 11) => {
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom, duration: 1200 });
    },
    [],
  );

  const flyToBounds = useCallback(
    (bbox: [number, number, number, number]) => {
      mapRef.current?.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 60, duration: 1200 },
      );
    },
    [],
  );

  // Derived, not state: deriving during render drops a re-render per filter change.
  const filteredPhotos = useMemo(() => {
    if (selectedYear === null) return photos;
    return photos.filter((photo) => {
      if (!photo.date) return false;
      return new Date(photo.date).getFullYear() === selectedYear;
    });
  }, [selectedYear, photos]);

  const points = filteredPhotos
    .filter((p) => p.lat != null && p.lon != null)
    .map((photo) => ({
      type: "Feature" as const,
      properties: { cluster: false, photo },
      geometry: {
        type: "Point" as const,
        coordinates: [photo.lon!, photo.lat!],
      },
    }));

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds,
    zoom: viewState.zoom,
    options: { radius: 60, maxZoom: 20 },
  });

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapStyle = MAP_STYLES[theme];

  return (
    <>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={onMove}
        onLoad={() => {
          updateBounds();
          setMapLoaded(true);
        }}
        style={{ height: "100vh", width: "100%" }}
        mapStyle={mapStyle}
        mapboxAccessToken={mapboxToken}
        projection="globe"
        minZoom={1}
        attributionControl={false}
      >
        {clusters.map((cluster) => {
          const [longitude, latitude] = cluster.geometry.coordinates;
          const props = cluster.properties as ClusterProps;
          const isCluster = props.cluster;
          const pointCount = props.point_count ?? 0;

          if (isCluster) {
            const leaves = supercluster!.getLeaves(cluster.id as number, 3);
            const thumbs = leaves.map(
              (l) => (l.properties as ClusterProps).photo!.thumb_url,
            );

            return (
              <Marker
                key={`cluster-${cluster.id}`}
                longitude={longitude}
                latitude={latitude}
                anchor="center"
                onClick={() => {
                  const zoom = Math.min(
                    supercluster!.getClusterExpansionZoom(cluster.id as number),
                    20,
                  );
                  setViewState((v) => ({ ...v, longitude, latitude, zoom }));
                }}
              >
                <div className="cluster-marker-container">
                  {thumbs.length === 1 ? (
                    <div
                      style={{
                        backgroundImage: `url('${thumbs[0]}')`,
                        width: "100%",
                        height: "100%",
                        backgroundSize: "cover",
                        borderRadius: "50%",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "100%",
                        borderRadius: "50%",
                        overflow: "hidden",
                      }}
                    >
                      {thumbs.map((thumb, i) => {
                        let s: React.CSSProperties = {
                          position: "absolute",
                          backgroundImage: `url('${thumb}')`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        };
                        if (thumbs.length === 2) {
                          s = {
                            ...s,
                            left: `${i * 50}%`,
                            top: 0,
                            width: "50%",
                            height: "100%",
                          };
                        } else {
                          s =
                            i === 0
                              ? {
                                  ...s,
                                  left: 0,
                                  top: 0,
                                  width: "100%",
                                  height: "50%",
                                }
                              : {
                                  ...s,
                                  left: `${(i - 1) * 50}%`,
                                  top: "50%",
                                  width: "50%",
                                  height: "50%",
                                };
                        }
                        return <div key={i} style={s} />;
                      })}
                    </div>
                  )}
                  <div className="cluster-count-badge">{pointCount}</div>
                </div>
              </Marker>
            );
          }

          const photo = (cluster.properties as ClusterProps).photo!;
          return (
            <Marker
              key={photo.id}
              longitude={longitude}
              latitude={latitude}
              anchor="center"
              onClick={() => {
                setImgLoaded(false);
                window.location.hash = photo.friendly_name;
              }}
            >
              <div
                className="photo-marker"
                style={{ backgroundImage: `url('${photo.thumb_url}')` }}
              />
            </Marker>
          );
        })}
      </Map>

      <DateFilter
        photos={photos}
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
      />

      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      <LocationSidebar
        photos={filteredPhotos}
        mapboxToken={mapboxToken}
        onSelect={(g) => flyTo(g.longitude, g.latitude, g.count > 1 ? 11 : 14)}
      />

      <SearchBox
        mapboxToken={mapboxToken}
        onSelect={(p: PlaceSuggestion) => {
          if (p.bbox) flyToBounds(p.bbox);
          else flyTo(p.longitude, p.latitude, 10);
        }}
      />

      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            className="modal-overlay"
            onClick={() => (window.location.hash = "")}
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
              {!imgLoaded && (
                <div
                  className="skeleton-pulse"
                  style={{
                    width: "min(calc(100vw - 40px), 800px)",
                    height: "min(65dvh, 500px)",
                    borderRadius: 4,
                    margin: "0 auto",
                  }}
                />
              )}
              <img
                src={selectedPhoto.large_url}
                alt="Full size"
                onLoad={() => setImgLoaded(true)}
                style={{
                  maxWidth: "calc(100vw - 40px)",
                  maxHeight: "65dvh",
                  width: "auto",
                  height: "auto",
                  display: imgLoaded ? "block" : "none",
                  margin: "0 auto",
                  borderRadius: "4px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                }}
              />
              <div className="modal-traffic-lights">
                <button
                  className="modal-close-btn"
                  aria-label="Close photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.hash = "";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
                {/* Keyed by slug so a new photo remounts with a fresh, uncached card. */}
                <ShareButton
                  key={selectedPhoto.friendly_name}
                  slug={selectedPhoto.friendly_name}
                  caption={selectedPhoto.caption || selectedPhoto.original_name}
                  version={shareVersion(selectedPhoto)}
                />
              </div>
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
                <div
                  style={{ fontSize: "0.8em", opacity: 0.8, marginTop: "4px" }}
                >
                  {new Date(selectedPhoto.date).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
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
