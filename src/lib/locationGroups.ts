import Supercluster from "supercluster";
import { Photo } from "@/app/types";

export interface LocationGroup {
  id: string;
  longitude: number;
  latitude: number;
  count: number;
  photoIds: string[];
}

/**
 * Groups photos into geographic clusters at a fixed radius/zoom — independent
 * of the map's live viewState — so the sidebar gets a stable list of "places"
 * (e.g. one entry for all of NYC) instead of reshuffling as you pan and zoom.
 */
export function getLocationGroups(photos: Photo[]): LocationGroup[] {
  const points = photos
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => ({
      type: "Feature" as const,
      properties: { photoId: p.id },
      geometry: {
        type: "Point" as const,
        coordinates: [p.lon!, p.lat!],
      },
    }));

  if (points.length === 0) return [];

  const index = new Supercluster({ radius: 80, maxZoom: 8 }).load(points);
  const clusters = index.getClusters([-180, -85, 180, 85], 6);

  const groups = clusters.map((c) => {
    const [longitude, latitude] = c.geometry.coordinates;

    if (c.properties.cluster) {
      const leaves = index.getLeaves(c.id as number, Infinity);
      return {
        id: `cluster-${c.id}`,
        longitude,
        latitude,
        count: c.properties.point_count as number,
        photoIds: leaves.map((l) => l.properties.photoId as string),
      };
    }

    return {
      id: `point-${c.properties.photoId}`,
      longitude,
      latitude,
      count: 1,
      photoIds: [c.properties.photoId as string],
    };
  });

  return groups.sort((a, b) => b.count - a.count);
}
