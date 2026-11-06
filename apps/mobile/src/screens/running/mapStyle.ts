// The map under a run, drawn in the app's own colours (ROADMAP Stage 5 37b-i): streets and their
// names, parks, water, buildings and landmarks, light by day and dark at night. One look for each map
// maker the server may name (OpenFreeMap's OpenMapTiles layers; Protomaps' for our own copy), so the
// switch needs no new app version. Pure: the tests read the style it gives.
import type { LayerSpecification, LineLayerSpecification, StyleSpecification, SymbolLayerSpecification } from "@maplibre/maplibre-react-native";
import type { MapSource } from "@app/shared";
import { mapColours } from "../../look/colours";

export type MapScheme = "light" | "dark";
type Palette = (typeof mapColours)[MapScheme];
type Fonts = { regular: string; italic: string; bold: string };
type Width = NonNullable<NonNullable<LineLayerSpecification["paint"]>["line-width"]>;
type Filter = NonNullable<LineLayerSpecification["filter"]>;
type Words = NonNullable<NonNullable<SymbolLayerSpecification["layout"]>["text-field"]>;
type WordSize = NonNullable<NonNullable<SymbolLayerSpecification["layout"]>["text-size"]>;
type Picture = NonNullable<NonNullable<SymbolLayerSpecification["layout"]>["icon-image"]>;

/** The letters each maker's font server holds. */
export function mapFonts(maker: MapSource["maker"]): Fonts {
  return maker === "openmaptiles"
    ? { regular: "Noto Sans Regular", italic: "Noto Sans Italic", bold: "Noto Sans Bold" }
    : { regular: "Noto Sans Regular", italic: "Noto Sans Italic", bold: "Noto Sans Medium" };
}

/** The one source every map layer reads: the map squares, and nothing else. */
export const MAP_TILES = "basemap";

const zoomWidth = (stops: readonly (readonly [number, number])[]): Width => ["interpolate", ["exponential", 1.2], ["zoom"], ...stops.flat()];
const wider = (stops: readonly (readonly [number, number])[]) => stops.map(([z, w]): [number, number] => [z, w + 2]);
const wordSize = (from: number, to: number): WordSize => ["interpolate", ["linear"], ["zoom"], 14, from, 18, to];

/** A name as the map gives it: the English one where the map has one, as OpenStreetMap's own maps. */
const NAME: Words = ["coalesce", ["get", "name_en"], ["get", "name:en"], ["get", "name"]];
/** A landmark's small picture, by what it is (OpenFreeMap's pictures are named by OpenMapTiles' kinds). */
const LANDMARK_PICTURE: Picture = ["match", ["get", "subclass"], ["florist", "furniture"], ["get", "subclass"], ["get", "class"]];

const of = (field: "class" | "kind", names: readonly string[]): Filter => ["match", ["get", field], [...names], true, false];
const notUnder = (names: readonly string[]): Filter => ["all", ["match", ["get", "class"], [...names], true, false], ["!=", ["get", "brunnel"], "tunnel"]];
const at = (sourceLayer: string) => ({ source: MAP_TILES, "source-layer": sourceLayer });
const round = { "line-cap": "round", "line-join": "round" } as const;

export function baseMapStyle(source: MapSource, scheme: MapScheme): StyleSpecification {
  const p = mapColours[scheme];
  const fonts = mapFonts(source.maker);
  return {
    version: 8,
    name: `run-map-${source.maker}-${scheme}`,
    glyphs: source.glyphs,
    ...(source.sprite === null ? {} : { sprite: source.sprite }),
    sources: { [MAP_TILES]: { type: "vector", url: source.tiles } },
    layers: [
      { id: "land", type: "background", paint: { "background-color": p.land } },
      ...(source.maker === "openmaptiles" ? openMapTilesLayers(p, fonts, source.sprite !== null) : protomapsLayers(p, fonts)),
    ],
  };
}

/** A street of one kind: its edge under it, then the street. */
function street(id: string, layer: string, filter: Filter, colour: string, edge: string, widths: readonly (readonly [number, number])[], minzoom: number): LineLayerSpecification[] {
  return [
    { id: `${id}-edge`, type: "line", ...at(layer), minzoom, filter, layout: round, paint: { "line-color": edge, "line-width": zoomWidth(wider(widths)) } },
    { id, type: "line", ...at(layer), minzoom, filter, layout: round, paint: { "line-color": colour, "line-width": zoomWidth(widths) } },
  ];
}

const MINOR: readonly (readonly [number, number])[] = [[12.5, 0.4], [14, 2.5], [20, 18]];
const MEDIUM: readonly (readonly [number, number])[] = [[9, 0.6], [14, 4], [20, 24]];
const MAJOR: readonly (readonly [number, number])[] = [[6, 0.6], [14, 5], [20, 28]];
const MOTORWAY: readonly (readonly [number, number])[] = [[5, 0.6], [14, 6], [20, 30]];
const PATH: readonly (readonly [number, number])[] = [[14, 0.8], [18, 2.5]];

/** OpenFreeMap's layers (the OpenMapTiles schema). */
function openMapTilesLayers(p: Palette, f: Fonts, pictures: boolean): LayerSpecification[] {
  return [
    { id: "residential", type: "fill", ...at("landuse"), filter: of("class", ["residential"]), paint: { "fill-color": p.residential } },
    { id: "wood", type: "fill", ...at("landcover"), filter: of("class", ["wood", "forest"]), paint: { "fill-color": p.wood } },
    { id: "grass", type: "fill", ...at("landcover"), filter: of("class", ["grass", "farmland", "wetland"]), paint: { "fill-color": p.park } },
    { id: "sand", type: "fill", ...at("landcover"), filter: of("class", ["sand"]), paint: { "fill-color": p.sand } },
    { id: "park", type: "fill", ...at("park"), paint: { "fill-color": p.park } },
    { id: "green", type: "fill", ...at("landuse"), filter: of("class", ["pitch", "track", "cemetery", "stadium", "playground", "grass"]), paint: { "fill-color": p.park } },
    { id: "water", type: "fill", ...at("water"), filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": p.water } },
    { id: "waterway", type: "line", ...at("waterway"), filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "line-color": p.waterLine, "line-width": zoomWidth([[10, 0.6], [16, 3]]) } },
    { id: "building", type: "fill", ...at("building"), minzoom: 14, paint: { "fill-color": p.building } },
    { id: "path", type: "line", ...at("transportation"), minzoom: 14, filter: notUnder(["path", "track"]), paint: { "line-color": p.pathEdge, "line-width": zoomWidth(PATH), "line-dasharray": [2, 1.5] } },
    { id: "rail", type: "line", ...at("transportation"), filter: notUnder(["rail", "transit"]), paint: { "line-color": p.rail, "line-width": zoomWidth([[12, 0.8], [18, 2.5]]) } },
    ...street("minor", "transportation", notUnder(["minor", "service"]), p.minor, p.minorEdge, MINOR, 12),
    ...street("medium", "transportation", notUnder(["secondary", "tertiary"]), p.major, p.majorEdge, MEDIUM, 8),
    ...street("major", "transportation", notUnder(["primary", "trunk"]), p.major, p.majorEdge, MAJOR, 6),
    ...street("motorway", "transportation", notUnder(["motorway"]), p.motorway, p.majorEdge, MOTORWAY, 5),
    { id: "water-name", type: "symbol", ...at("water_name"), layout: { "text-field": NAME, "text-font": [f.italic], "text-size": 12, "text-max-width": 8 }, paint: { "text-color": p.waterName, "text-halo-color": p.halo, "text-halo-width": 1 } },
    { id: "street-name", type: "symbol", ...at("transportation_name"), minzoom: 14, layout: { "symbol-placement": "line", "text-field": NAME, "text-font": [f.regular], "text-size": wordSize(10.5, 13), "text-rotation-alignment": "map" }, paint: { "text-color": p.name, "text-halo-color": p.halo, "text-halo-width": 1.2 } },
    {
      id: "landmark",
      type: "symbol",
      ...at("poi"),
      minzoom: 15,
      filter: ["<", ["get", "rank"], 20],
      layout: {
        ...(pictures ? { "icon-image": LANDMARK_PICTURE } : {}),
        "text-field": NAME,
        "text-font": [f.italic],
        "text-size": 11,
        "text-max-width": 9,
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-optional": true,
      },
      paint: { "text-color": p.landmark, "text-halo-color": p.halo, "text-halo-width": 1 },
    },
    {
      id: "place",
      type: "symbol",
      ...at("place"),
      filter: of("class", ["city", "town", "village", "suburb", "neighbourhood", "quarter", "hamlet"]),
      layout: { "text-field": NAME, "text-font": [f.regular], "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.1, "text-max-width": 9 },
      paint: { "text-color": p.place, "text-halo-color": p.halo, "text-halo-width": 1.2 },
    },
  ];
}

/** Protomaps' layers (its basemap schema, version 4): our own copy's, the day OpenFreeMap stops. */
function protomapsLayers(p: Palette, f: Fonts): LayerSpecification[] {
  return [
    { id: "earth", type: "fill", ...at("earth"), paint: { "fill-color": p.land } },
    { id: "green", type: "fill", ...at("landuse"), filter: of("kind", ["park", "garden", "grass", "golf_course", "cemetery", "pitch", "playground", "nature_reserve"]), paint: { "fill-color": p.park } },
    { id: "wood", type: "fill", ...at("landuse"), filter: of("kind", ["wood", "forest"]), paint: { "fill-color": p.wood } },
    { id: "sand", type: "fill", ...at("landuse"), filter: of("kind", ["beach", "sand"]), paint: { "fill-color": p.sand } },
    { id: "water", type: "fill", ...at("water"), paint: { "fill-color": p.water } },
    { id: "building", type: "fill", ...at("buildings"), minzoom: 14, paint: { "fill-color": p.building } },
    { id: "path", type: "line", ...at("roads"), minzoom: 14, filter: of("kind", ["path"]), paint: { "line-color": p.pathEdge, "line-width": zoomWidth(PATH), "line-dasharray": [2, 1.5] } },
    { id: "rail", type: "line", ...at("roads"), filter: of("kind", ["rail"]), paint: { "line-color": p.rail, "line-width": zoomWidth([[12, 0.8], [18, 2.5]]) } },
    ...street("minor", "roads", of("kind", ["minor_road", "other"]), p.minor, p.minorEdge, MINOR, 12),
    ...street("medium", "roads", of("kind", ["medium_road"]), p.major, p.majorEdge, MEDIUM, 8),
    ...street("major", "roads", of("kind", ["major_road"]), p.major, p.majorEdge, MAJOR, 6),
    ...street("motorway", "roads", of("kind", ["highway"]), p.motorway, p.majorEdge, MOTORWAY, 5),
    { id: "street-name", type: "symbol", ...at("roads"), minzoom: 14, layout: { "symbol-placement": "line", "text-field": NAME, "text-font": [f.regular], "text-size": wordSize(10.5, 13) }, paint: { "text-color": p.name, "text-halo-color": p.halo, "text-halo-width": 1.2 } },
    { id: "landmark", type: "symbol", ...at("pois"), minzoom: 15, layout: { "text-field": NAME, "text-font": [f.italic], "text-size": 11, "text-max-width": 9 }, paint: { "text-color": p.landmark, "text-halo-color": p.halo, "text-halo-width": 1 } },
    { id: "place", type: "symbol", ...at("places"), layout: { "text-field": NAME, "text-font": [f.regular], "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.1 }, paint: { "text-color": p.place, "text-halo-color": p.halo, "text-halo-width": 1.2 } },
  ];
}
