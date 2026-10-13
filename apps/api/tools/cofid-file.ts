// The UK table's workbook (McCance and Widdowson's Composition of Foods Integrated
// Dataset, 2021), read for `check-food-sources.ts`.
import { fail, unzip, type UsdaNutrient } from "./usda-files.js";

export const COFID_URL =
  "https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx";

export interface CofidEntry {
  /** CoFID's food name. */
  description: string;
  /** CoFID's own note on what the food is and how it was sampled or made. */
  note: string;
  figures: Map<UsdaNutrient, number | null>;
}

const decodeXml = (s: string): string =>
  s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");

/** CoFID's "1.3 Proximates" sheet, by food code. "Tr" (trace) is 0; "N" (not
 *  measured) and an empty cell are null. Fibre is AOAC, or NSP where AOAC is null. */
export function cofidTable(archive: Buffer): Map<string, CofidEntry> {
  const files = unzip(archive, (name) => name.startsWith("xl/"));
  const xml = (name: string): string => files.get(name)?.toString("utf8") ?? fail(`no ${name} in the workbook`);
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    decodeXml([...(si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join("")),
  );
  const sheetRel = /<sheet [^>]*name="1\.3 Proximates"[^>]*r:id="([^"]+)"/.exec(xml("xl/workbook.xml"))?.[1] ?? fail("no Proximates sheet");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const target = [...rels.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${sheetRel}"`));
  const sheetPath = /Target="([^"]+)"/.exec(target ?? "")?.[1] ?? fail("no Proximates sheet file");
  const rows: Map<string, string>[] = [];
  for (const rowXml of xml(`xl/${sheetPath}`).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<string, string>();
    for (const cell of (rowXml[1] ?? "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = cell[1] ?? "";
      const attributes = cell[2] ?? "";
      const inner = cell[3] ?? "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (attributes.includes('t="s"')) cells.set(column, shared[Number(value)] ?? "");
      else if (attributes.includes('t="inlineStr"')) cells.set(column, decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ""));
      else cells.set(column, decodeXml(value ?? ""));
    }
    rows.push(cells);
  }
  const header = rows[0] ?? fail("an empty Proximates sheet");
  const column = (title: string): string => [...header].find(([, v]) => v === title)?.[0] ?? fail(`no "${title}" column`);
  const code = column("Food Code");
  const name = column("Food Name");
  const read = (row: Map<string, string>, title: string): number | null => {
    const raw = (row.get(column(title)) ?? "").trim();
    if (raw === "Tr") return 0;
    if (raw === "N" || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fail(`"${raw}" in ${title}`);
  };
  const note = column("Description");
  const table = new Map<string, CofidEntry>();
  for (const row of rows.slice(1)) {
    const id = row.get(code);
    if (id === undefined || !/^\d{2}-\d+$/.test(id)) continue;
    const figures = new Map<UsdaNutrient, number | null>([
      ["kcal", read(row, "Energy (kcal) (kcal)")],
      ["proteinG", read(row, "Protein (g)")],
      ["carbsG", read(row, "Carbohydrate (g)")],
      ["fatG", read(row, "Fat (g)")],
      ["fiberG", read(row, "AOAC fibre (g)") ?? read(row, "NSP (g)")],
    ]);
    table.set(id, { description: row.get(name) ?? "", note: row.get(note) ?? "", figures });
  }
  return table;
}
