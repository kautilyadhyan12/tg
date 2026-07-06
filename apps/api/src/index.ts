// apps/api — Fastify modular monolith (spec v1 §6). Boot lands in P0.4.
// R1.3: no stub that fakes success — fail loudly until implemented.
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented yet: ${what}`);
    this.name = "NotImplementedError";
  }
}

export function main(): never {
  throw new NotImplementedError("apps/api boot (task P0.4)");
}
