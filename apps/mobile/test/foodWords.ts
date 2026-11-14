import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Every word the Food tab can show or read aloud, taken from its source: the words between tags, and
// each string or piece of a template that reads as words (a space, a capital or an end mark). Icon
// names, colours and kinds are single lowercase words and are left out.

const here = join(__dirname, "..");

export function foodFiles(): string[] {
  const folder = join(here, "src", "screens", "food");
  return [join(here, "src", "screens", "Food.tsx"), ...readdirSync(folder).filter((f) => /\.tsx?$/.test(f)).map((f) => join(folder, f))];
}

const WORDY = /[A-Za-z]/;
const reads = (s: string) => WORDY.test(s) && (/\s/.test(s) || /^[A-Z]/.test(s) || /[.?!…:]$/.test(s)) && !s.startsWith("/");

export function foodWords(files: readonly string[] = foodFiles()): Set<string> {
  const out = new Set<string>();
  for (const path of files) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (WORDY.test(text)) out.add(text);
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (reads(node.text)) out.add(node.text);
      } else if (ts.isTemplateExpression(node)) {
        for (const piece of [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]) {
          const text = piece.trim();
          if (text.length > 1 && reads(piece)) out.add(text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}
