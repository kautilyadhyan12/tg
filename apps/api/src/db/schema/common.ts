// Shared column builders for the Part 4 §1 conventions.
import { customType, timestamp } from "drizzle-orm/pg-core";

// citext extension (Part 4 §1 Extensions) — emails.
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// pgvector (Part 4 §3.7) — dimension pinned at the call site.
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[] }>({
    dataType() {
      return `vector(${String(dimensions)})`;
    },
  })(name);

// Part 4 §1: `created_at timestamptz NOT NULL DEFAULT now()` on every table.
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
