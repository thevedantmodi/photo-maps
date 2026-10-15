"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Map, { Marker } from "react-map-gl/mapbox";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/mapbox";
import Supercluster from "supercluster";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTheme } from "../hooks/useTheme";
import { MAP_STYLES } from "@/lib/mapStyles";
import { photoAlt } from "@/lib/alt";
import {
  applyRelief,
  setTerrain,
  DEM_SOURCE_ID,
  PLACE_PITCH,
  PLACE_PITCH_MIN_ZOOM,
} from "@/lib/mapTerrain";
import { useTerrainPreference } from "../hooks/useTerrainPreference";
import { rememberOpen } from "@/lib/photoTransition";

import SiteHeader from "./SiteHeader";
import YearFilter from "./YearFilter";
import TerrainToggle from "./TerrainToggle";
import PhotoStack, { fanExtent } from "./PhotoStack";
import SearchBox from "./SearchBox";
import Mark from "./Mark";
import { PlaceSuggestion } from "@/lib/mapboxGeocode";
import type { CustomPlace } from "@/lib/customPlaces";
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
  places: CustomPlace[];
}

// Screen-pixel shift for flyTo/fitBounds; positive y lands the target below center.
const FLY_OFFSET: [number, number] = [0, 40];

// Deepest zoom clusters split at. A cluster that still wouldn't split past it
// is a stack of photos on (near enough) the same spot, so it fans out instead.
const MAX_CLUSTER_ZOOM = 20;

// A group this small opens as a wheel of its photos instead of zooming in.
const WHEEL_MAX = 12;

// Room kept between an open stack's fan and the viewport edge.
const STACK_EDGE_MARGIN = 16;

// Marker sizes; keep in step with the fan geometry in PhotoStack.
const SINGLE_SIZE = 56;
const CLUSTER_SIZE = 72;

// Photos fade out for this long before the year filter re-clusters the map.
const YEAR_FADE_MS = 150;

// On first load the photos are hung one after another, in date order.
const HANG_STEP_MS = 35;
const HANG_MAX_MS = 900;

// How long the searched place's name stays up after the map arrives.
const PLACE_NAME_MS = 1500;
const FLY_MS = 1000;

const CAMERA_KEY = "photo-maps:camera";

interface Camera {
  longitude: number;
  latitude: number;
  zoom: number;
}

const DEFAULT_CAMERA: Camera = {
  longitude: -96.40442327908295,
  latitude: 39.206117736168125,
  zoom: 2,
};

/**
 * Where the map opens: a place linked from the Directory (?lon=&lat=&z=), else where
 * this tab last left it, else the world.
 */
function initialCamera(): Camera {
  const params = new URLSearchParams(window.location.search);
  const lon = Number(params.get("lon"));
  const lat = Number(params.get("lat"));
  const z = Number(params.get("z"));
  if (
    params.has("lon") &&
    params.has("lat") &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
  ) {
    return { longitude: lon, latitude: lat, zoom: Number.isFinite(z) && z > 0 ? Math.min(z, 18) : 10 };
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(CAMERA_KEY) ?? "null");
    if (
      saved &&
      Number.isFinite(saved.longitude) &&
      Number.isFinite(saved.latitude) &&
      Number.isFinite(saved.zoom)
    ) {
      return { longitude: saved.longitude, latitude: saved.latitude, zoom: saved.zoom };
    }
  } catch {
    // Unreadable or unavailable; start from the world.
  }
  return DEFAULT_CAMERA;
}

interface OpenStack {
  clusterId: number;
  longitude: number;
  latitude: number;
  photos: Photo[];
}

const yearOf = (p: Photo) => (p.date ? new Date(p.date).getFullYear() : null);

const MapComponent = ({ photos, places }: MapProps) => {
  const router = useRouter();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  // While set, photos not in this year fade out; then the filter applies.
  const [pendingYear, setPendingYear] = useState<number | null | undefined>(undefined);
  // Cluster ids are only stable within one zoom level, so anything that
  // changes zoom or the point set closes the stack.
  const [openStack, setOpenStack] = useState<OpenStack | null>(null);
  const [viewState, setViewState] = useState(initialCamera);
  const [bounds, setBounds] = useState<[number, number, number, number]>([
    -180, -85, 180, 85,
  ]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hanging, setHanging] = useState(true);
  const [placeName, setPlaceName] = useState<{ text: string; on: boolean }>({
    text: "",
    on: false,
  });
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const yearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<MapRef>(null);
  const [theme] = useTheme();
  const [terrainEnabled, toggleTerrain] = useTerrainPreference();
  // Read by the style.load listener, which outlives any one render.
  const themeRef = useRef(theme);
  const terrainRef = useRef(terrainEnabled);

  // Tells the theme switch to keep the lights down until the new map style is in.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-map-present", "");
    return () => root.removeAttribute("data-map-present");
  }, []);

  // Photos used to open at /#<slug>; send any such link on to the photo's page.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let slug = hash;
    try {
      slug = decodeURIComponent(hash);
    } catch {
      // Malformed escape; use it as typed.
    }
    router.replace(`/p/${encodeURIComponent(slug)}`);
  }, [router]);

  // Escape folds the wheel and hands focus back to the cluster it came from.
  const openStackRef = useRef<OpenStack | null>(null);
  useEffect(() => {
    openStackRef.current = openStack;
  }, [openStack]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const open = openStackRef.current;
      setOpenStack(null);
      if (open && document.activeElement?.closest(".photo-stack")) {
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>(`[data-cluster="${open.clusterId}"]`)?.focus(),
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(
    () => () => {
      if (placeTimer.current) clearTimeout(placeTimer.current);
      if (yearTimer.current) clearTimeout(yearTimer.current);
    },
    [],
  );

  const updateBounds = useCallback(() => {
    if (mapRef.current) {
      const b = mapRef.current.getBounds()!;
      setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    }
  }, []);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const saveCamera = useCallback((longitude: number, latitude: number, zoom: number) => {
    try {
      sessionStorage.setItem(CAMERA_KEY, JSON.stringify({ longitude, latitude, zoom }));
    } catch {
      // Storage unavailable; the map just won't remember.
    }
  }, []);

  // A theme switch swaps the whole style, dropping the DEM source, hillshade,
  // terrain and fog; style.load puts them back, then lets the lights come up.
  // Photos are DOM markers and the camera is controlled state, so neither is
  // touched by the swap.
  const onMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const restore = () => {
      applyRelief(map, themeRef.current, terrainRef.current);
      window.dispatchEvent(new Event("pm:map-styled"));
    };
    restore();
    map.on("style.load", restore);
    // Remember where the map opened, too: arriving from a link and leaving without moving
    // should still come back to the same place.
    saveCamera(map.getCenter().lng, map.getCenter().lat, map.getZoom());
    updateBounds();
    setMapLoaded(true);
    setTimeout(() => setHanging(false), HANG_MAX_MS + 400);
  }, [updateBounds, saveCamera]);

  useEffect(() => {
    terrainRef.current = terrainEnabled;
    if (!mapLoaded) return;
    const map = mapRef.current?.getMap();
    // Mid style swap the source is gone; style.load applies the new value.
    if (!map?.getSource(DEM_SOURCE_ID)) return;
    setTerrain(map, terrainEnabled);
    if (!terrainEnabled && map.getPitch() > 0) {
      map.easeTo({ pitch: 0, duration: 400 });
    } else if (terrainEnabled && map.getZoom() >= PLACE_PITCH_MIN_ZOOM) {
      map.easeTo({ pitch: PLACE_PITCH, duration: 400 });
    }
  }, [terrainEnabled, mapLoaded]);

  const onMove = useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);
      updateBounds();
    },
    [updateBounds],
  );

  // Remembered per tab, so coming back from a photo or the Directory lands where you were.
  const onMoveEnd = useCallback(
    (evt: ViewStateChangeEvent) => {
      const { longitude, latitude, zoom } = evt.viewState;
      saveCamera(longitude, latitude, zoom);
    },
    [saveCamera],
  );

  // Lands the place a little below center, clear of the header.
  const flyTo = useCallback(
    (longitude: number, latitude: number, zoom = 11) => {
      // A slight tilt shows off the relief once there's some to see.
      const pitch =
        terrainEnabled && zoom >= PLACE_PITCH_MIN_ZOOM ? PLACE_PITCH : 0;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom, pitch, offset: FLY_OFFSET, duration: FLY_MS });
    },
    [terrainEnabled],
  );

  const flyToBounds = useCallback(
    (bbox: [number, number, number, number]) => {
      mapRef.current?.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 60, offset: FLY_OFFSET, pitch: 0, duration: FLY_MS },
      );
    },
    [],
  );

  const showPlaceName = useCallback((name: string) => {
    if (placeTimer.current) clearTimeout(placeTimer.current);
    setPlaceName({ text: name.split(",")[0].trim(), on: true });
    placeTimer.current = setTimeout(
      () => setPlaceName((p) => ({ ...p, on: false })),
      FLY_MS + PLACE_NAME_MS,
    );
  }, []);

  // Zoomed out, the relief is too small to see and the map doesn't tilt yet, so a note
  // under the switch says so rather than leave it looking like it did nothing.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);
  const terrainNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (terrainNoteTimer.current) clearTimeout(terrainNoteTimer.current);
    },
    [],
  );
  const chooseTerrain = useCallback(
    (on: boolean) => {
      if (on === terrainEnabled) return;
      toggleTerrain();
      if (terrainNoteTimer.current) clearTimeout(terrainNoteTimer.current);
      const zoom = mapRef.current?.getMap().getZoom() ?? 0;
      if (on && zoom < PLACE_PITCH_MIN_ZOOM) {
        setTerrainNote("Zoom in to see it");
        terrainNoteTimer.current = setTimeout(() => setTerrainNote(null), 3000);
      } else {
        setTerrainNote(null);
      }
    },
    [terrainEnabled, toggleTerrain],
  );

  const openStackAt = useCallback(
    (clusterId: number, longitude: number, latitude: number, photos: Photo[]) => {
      setOpenStack({ clusterId, longitude, latitude, photos });
      const map = mapRef.current?.getMap();
      if (!map) return;
      // Pan only when the fan would spill off screen; zoom stays put so the
      // stack isn't closed by its own move.
      const reach = fanExtent(photos.length) + STACK_EDGE_MARGIN;
      const { x, y } = map.project([longitude, latitude]);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      if (x < reach || x > w - reach || y < reach || y > h - reach) {
        map.easeTo({ center: [longitude, latitude], offset: FLY_OFFSET, duration: 300 });
      }
    },
    [],
  );

  // The photo grows out of the thumbnail that was clicked (see PhotoView).
  const openPhoto = useCallback(
    (photo: Photo, el: Element) => {
      rememberOpen(photo.friendly_name, el);
      router.push(`/p/${encodeURIComponent(photo.friendly_name)}`, { scroll: false });
    },
    [router],
  );

  // Picking a year whose photos are all out of sight (another continent, the far side of
  // the globe) would leave an empty map, so the map moves to them. If any is already in
  // view it stays put.
  const revealYear = useCallback(
    (year: number) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const located = photos.filter((p) => yearOf(p) === year && p.lat != null && p.lon != null);
      if (located.length === 0) return;
      const canvas = map.getCanvas();
      const center = map.getCenter();
      const toRad = Math.PI / 180;
      const visible = located.some((p) => {
        const { x, y } = map.project([p.lon!, p.lat!]);
        if (x < 0 || y < 0 || x > canvas.clientWidth || y > canvas.clientHeight) return false;
        // Great-circle distance from the centre: past ~80° the point is round the back.
        const cos =
          Math.sin(center.lat * toRad) * Math.sin(p.lat! * toRad) +
          Math.cos(center.lat * toRad) * Math.cos(p.lat! * toRad) * Math.cos((p.lon! - center.lng) * toRad);
        return cos > Math.cos(80 * toRad);
      });
      if (visible) return;
      let lons = located.map((p) => p.lon!);
      // Photos either side of the date line: measure across it, not round the world.
      if (Math.max(...lons) - Math.min(...lons) > 180) lons = lons.map((l) => (l < 0 ? l + 360 : l));
      const lats = located.map((p) => p.lat!);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 80, maxZoom: 9, offset: FLY_OFFSET, pitch: 0, duration: FLY_MS },
      );
    },
    [photos],
  );

  const changeYear = useCallback(
    (year: number | null) => {
      if (year === selectedYear || pendingYear !== undefined) return;
      setOpenStack(null);
      if (year !== null) revealYear(year);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setSelectedYear(year);
        return;
      }
      setPendingYear(year);
      yearTimer.current = setTimeout(() => {
        setSelectedYear(year);
        setPendingYear(undefined);
      }, YEAR_FADE_MS);
    },
    [selectedYear, pendingYear, revealYear],
  );

  // Derived, not state: deriving during render drops a re-render per filter change.
  const filteredPhotos = useMemo(() => {
    if (selectedYear === null) return photos;
    return photos.filter((photo) => yearOf(photo) === selectedYear);
  }, [selectedYear, photos]);

  // Date order for hanging the photos on first load; undated photos go last.
  const hangRank = useMemo(() => {
    const ranked = [...photos].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    return new globalThis.Map(ranked.map((p, i) => [p.id, i]));
  }, [photos]);

  // Rebuilt only when the photo set changes, not on every camera move.
  const supercluster = useMemo(() => {
    const index = new Supercluster<ClusterProps>({
      radius: 60,
      maxZoom: MAX_CLUSTER_ZOOM,
    });
    index.load(
      filteredPhotos
        .filter((p) => p.lat != null && p.lon != null)
        .map((photo) => ({
          type: "Feature" as const,
          properties: { cluster: false, photo },
          geometry: {
            type: "Point" as const,
            coordinates: [photo.lon!, photo.lat!],
          },
        })),
    );
    return index;
  }, [filteredPhotos]);

  // Computed during render rather than in an effect (as use-supercluster
  // did): an effect's setState added a second render on every move frame,
  // and a long flyTo tripped React's dev "Maximum update depth" warning.
  const roundedZoom = Math.round(viewState.zoom);
  const clusters = useMemo(
    () => (mapLoaded ? supercluster.getClusters(bounds, roundedZoom) : []),
    [supercluster, bounds, roundedZoom, mapLoaded],
  );

  const hangDelay = (photo: Photo) =>
    hanging ? Math.min((hangRank.get(photo.id) ?? 0) * HANG_STEP_MS, HANG_MAX_MS) : 0;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapStyle = MAP_STYLES[theme];

  return (
    <div className="mapshell">
      <SiteHeader
        current="map"
        tools={
          <>
            <SearchBox
              mapboxToken={mapboxToken}
              places={places}
              onSelect={(p: PlaceSuggestion) => {
                showPlaceName(p.name);
                if (p.bbox) flyToBounds(p.bbox);
                else flyTo(p.longitude, p.latitude, 8);
              }}
            />
            <TerrainToggle
              className="desktop-only"
              enabled={terrainEnabled}
              onChange={chooseTerrain}
              note={terrainNote}
            />
          </>
        }
        menuExtra={<TerrainToggle enabled={terrainEnabled} onChange={chooseTerrain} note={terrainNote} />}
      />

      <div className="mapframe">
        <Map
          ref={mapRef}
          {...viewState}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          onZoomStart={() => {
            if (openStack) setOpenStack(null);
          }}
          onClick={(e) => {
            // Marker clicks bubble up as map clicks too; only bare map closes.
            // composedPath, not target.closest: opening a stack unmounts the
            // clicked cluster before this runs, detaching the target.
            const onMarker = e.originalEvent
              .composedPath()
              .some(
                (n) =>
                  n instanceof Element && n.classList.contains("mapboxgl-marker"),
              );
            if (!onMarker) setOpenStack(null);
          }}
          onLoad={onMapLoad}
          style={{ height: "100%", width: "100%" }}
          mapStyle={mapStyle}
          // Full reload rather than a diff, so style.load fires on every theme
          // switch and the relief layers are re-added.
          styleDiffing={false}
          mapboxAccessToken={mapboxToken}
          projection="globe"
          minZoom={1}
          attributionControl={false}
        >
          {clusters.map((cluster) => {
            const [longitude, latitude] = cluster.geometry.coordinates;
            const props = cluster.properties as ClusterProps;

            if (props.cluster) {
              const clusterId = cluster.id as number;
              // The open stack draws its own fan at this spot.
              if (openStack?.clusterId === clusterId) return null;
              const pointCount = props.point_count ?? 0;
              const cover = (supercluster.getLeaves(clusterId, 1)[0]
                ?.properties as ClusterProps | undefined)?.photo;
              if (!cover) return null;
              const leaving =
                pendingYear !== undefined &&
                pendingYear !== null &&
                !supercluster
                  .getLeaves(clusterId, Infinity)
                  .some((l) => yearOf((l.properties as ClusterProps).photo!) === pendingYear);

              return (
                <Marker
                  key={`cluster-${cluster.id}`}
                  longitude={longitude}
                  latitude={latitude}
                  anchor="center"
                >
                  <div
                    className="mk"
                    data-leaving={leaving}
                    style={{ animationDelay: `${hangDelay(cover)}ms` }}
                  >
                    <button
                      type="button"
                      className="mk-thumb"
                      data-cluster={clusterId}
                      style={{ width: CLUSTER_SIZE, height: CLUSTER_SIZE }}
                      aria-label={
                        pointCount <= WHEEL_MAX
                          ? `${pointCount} photos here. Show them all`
                          : `${pointCount} photos here. Zoom in`
                      }
                      onClick={() => {
                        const expansionZoom =
                          supercluster.getClusterExpansionZoom(clusterId);
                        // Photos on one spot, or a small group: fan them out in a wheel
                        // around the group. Bigger groups zoom in to split apart.
                        if (expansionZoom > MAX_CLUSTER_ZOOM || pointCount <= WHEEL_MAX) {
                          const stacked = supercluster
                            .getLeaves(clusterId, Infinity)
                            .map((l) => (l.properties as ClusterProps).photo!);
                          openStackAt(clusterId, longitude, latitude, stacked);
                          return;
                        }
                        setViewState((v) => ({
                          ...v,
                          longitude,
                          latitude,
                          zoom: expansionZoom,
                        }));
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
                      <img src={cover.thumb_url} alt="" draggable={false} />
                    </button>
                    <span className="mk-label" aria-hidden="true">
                      ({String(pointCount).padStart(2, "0")})
                    </span>
                  </div>
                </Marker>
              );
            }

            const photo = props.photo!;
            const leaving =
              pendingYear !== undefined && pendingYear !== null && yearOf(photo) !== pendingYear;
            return (
              <Marker
                key={photo.id}
                longitude={longitude}
                latitude={latitude}
                anchor="center"
              >
                <div
                  className="mk"
                  data-leaving={leaving}
                  style={{ animationDelay: `${hangDelay(photo)}ms` }}
                >
                  <button
                    type="button"
                    className="mk-thumb"
                    style={{ width: SINGLE_SIZE, height: SINGLE_SIZE }}
                    aria-label={photoAlt(photo)}
                    onClick={(e) => openPhoto(photo, e.currentTarget)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnail */}
                    <img src={photo.thumb_url} alt="" draggable={false} />
                  </button>
                </div>
              </Marker>
            );
          })}

          {openStack && (
            <Marker
              longitude={openStack.longitude}
              latitude={openStack.latitude}
              anchor="center"
              style={{ zIndex: 1 }}
            >
              <PhotoStack photos={openStack.photos} onSelect={openPhoto} />
            </Marker>
          )}
        </Map>

        <p className="place-name" data-in={placeName.on} aria-live="polite">
          {placeName.text}
        </p>

        <div className="map-loader" data-done={mapLoaded} aria-hidden={mapLoaded}>
          <Mark variant="detailed" width={150} />
          <span className="sr-only">Loading the map</span>
        </div>
      </div>

      <YearFilter photos={photos} selectedYear={selectedYear} onYearChange={changeYear} />
    </div>
  );
};

export default MapComponent;
