export function cableFor(copy: { scheme: string; apiPort: unknown; metroPort: unknown }): {
  reverse: string[][];
  bundlerUrl: string;
  bundlerArgs: string[];
  link: string;
};
