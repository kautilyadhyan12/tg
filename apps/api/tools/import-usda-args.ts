// Which database `import-usda.ts` fills, worked out from the command line — pure
// and on its own so the rule that keeps a food importer off the wrong database
// can be tested without running the tool (ROADMAP 7a-iii-a).

/** The value of `--name=…` on a command line, or undefined. */
export const argValue = (argv: readonly string[], name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export type DatabaseUrlChoice = { url: string } | { problem: "none-given" } | { problem: "empty-variable"; variable: string };

/** The address is either typed out (`--database-url=`) or held by a variable the
 *  command NAMES (`--database-url-env=`). Nothing is silent: `DATABASE_URL` in
 *  the environment is never used unless it is the variable named, because on
 *  this machine it points at the real data.
 *
 *  Naming the variable is what a real environment uses — an address typed on the
 *  command line puts the database password into shell history and into the
 *  process list. */
export function databaseUrlFrom(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): DatabaseUrlChoice {
  const variable = argValue(argv, "database-url-env");
  if (variable !== undefined && variable !== "") {
    const held = env[variable];
    if (held === undefined || held === "") return { problem: "empty-variable", variable };
    return { url: held };
  }
  const typed = argValue(argv, "database-url");
  return typed === undefined || typed === "" ? { problem: "none-given" } : { url: typed };
}
