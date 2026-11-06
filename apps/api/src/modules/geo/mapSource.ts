// The map the phones draw runs on (ROADMAP Stage 5 37b-i): OpenFreeMap's, or our own copy of
// Protomaps' world file once MAP_SOURCE says so (RUNBOOK/switch-the-map.md). Worked out once, when the
// server starts, and checked by the same schema the phone reads it with.
import { OPENFREEMAP, mapSourceSchema, type MapSource } from "@app/shared";
import type { AppConfig } from "../../config.js";

export function mapSourceFor(config: Pick<AppConfig, "MAP_SOURCE" | "MAP_PROTOMAPS_FILE" | "MAP_PROTOMAPS_GLYPHS">): MapSource {
  if (config.MAP_SOURCE === "protomaps" && config.MAP_PROTOMAPS_FILE !== undefined && config.MAP_PROTOMAPS_GLYPHS !== undefined) {
    return mapSourceSchema.parse({
      maker: "protomaps",
      tiles: `pmtiles://${config.MAP_PROTOMAPS_FILE}`,
      glyphs: config.MAP_PROTOMAPS_GLYPHS,
      sprite: null,
      credit: "Protomaps © OpenStreetMap",
    });
  }
  return mapSourceSchema.parse(OPENFREEMAP);
}
