/**
 * Web Mercator math for the locator's map.
 *
 * The map is a few absolutely positioned tile images and markers, not a map
 * library: Leaflet alone would put the route over its bundle budget. Every
 * piece of geometry it needs lives here as pure functions — projection, which
 * tiles cover the viewport, fitting a circle into view, zooming around a
 * point — so the component is left with events and DOM.
 *
 * Zoom is continuous. Tiles are drawn at the nearest even zoom at or below
 * it and scaled up by the remainder, which is what makes pinch zoom smooth.
 * Only every other level is fetched, and only ever scaled up: the map is for
 * finding roughly where a store is, so a softer tile costs nothing, while
 * each skipped level is a set of tiles a phone on cell data never downloads
 * and a swap it never shows.
 * @module lib/events/mercator
 */

import type { LatLon } from './geo';

export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;
/** Only every this-many-th whole zoom has its tiles fetched; the rest scale up. */
const TILE_LEVEL_STEP = 2;
const MAX_LATITUDE = 85.05112878;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface MapView {
  center: LatLon;
  zoom: number;
}

export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** World pixel coordinates of a point at a zoom. */
export function project(point: LatLon, zoom: number): Point {
  const scale = worldSize(zoom);
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
  };
}

/** The zoom whose tiles are drawn for a (fractional) zoom: the nearest fetched level at or below it. */
export function tileLevel(zoom: number): number {
  return clampZoom(Math.floor(clampZoom(zoom) / TILE_LEVEL_STEP) * TILE_LEVEL_STEP);
}

/**
 * Tiles covering the viewport, positioned in screen pixels.
 * @param view - Current centre and (fractional) zoom
 * @param size - Viewport size in CSS pixels
 * @param z - Tile level to draw; defaults to the level for the view's zoom
 * @returns One placement per tile, columns wrapped around the antimeridian
 */
export function visibleTiles(view: MapView, size: Size, z = tileLevel(view.zoom)): TilePlacement[] {
  const scale = 2 ** (view.zoom - z);
  const count = 2 ** z;
  const c = project(view.center, z);
  const originX = c.x - size.width / 2 / scale;
  const originY = c.y - size.height / 2 / scale;
  const tiles: TilePlacement[] = [];
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + size.height / scale) / TILE_SIZE));
  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + size.width / scale) / TILE_SIZE);
  for (let y = firstY; y <= lastY; y++) {
    for (let col = firstX; col <= lastX; col++) {
      const x = ((col % count) + count) % count;
      tiles.push({
        key: `${z}/${col}/${y}`,
        z,
        x,
        y,
        left: (col * TILE_SIZE - originX) * scale,
        top: (y * TILE_SIZE - originY) * scale,
        size: TILE_SIZE * scale
      });
    }
  }
  return tiles;
}
