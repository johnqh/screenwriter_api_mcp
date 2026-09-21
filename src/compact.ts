/**
 * @fileoverview LLM-oriented output shaping (spec 07 section 8). Pure functions, unit tested.
 * Tool results are read by a model: minified JSON only where structure matters, screenplay-like text
 * for script content, short hashes, minute timestamps, empty fields dropped, and a hard ceiling that
 * truncates at item boundaries and says how to fetch the rest.
 */

export interface ElementView {
  id: string;
  styleName: string;
  text: string;
  contentHash?: string | undefined;
}

export interface SceneView {
  id: string;
  number: string | null;
  heading: string;
  synopsis: string;
  contentHash: string;
  elements: ElementView[];
  omitted?: boolean | undefined;
}

export interface OutlineSceneView {
  id: string;
  number: string | null;
  heading: string;
  omitted: boolean;
  synopsis: string;
  elementCount: number;
  contentHash: string;
}

/** `v1:` + first 12 hex characters. Other strings pass through. */
export function shortHash(hash: string | undefined | null): string {
  if (!hash) return "";
  const m = /^(v\d+:)([0-9a-f]+)$/.exec(hash);
  return m ? `${m[1]}${m[2]!.slice(0, 12)}` : hash;
}

/** True for a full hash (v1: + 64 hex), false for a shortened one. */
export const isFullHash = (hash: string): boolean => /^v\d+:[0-9a-f]{64}$/.test(hash);
export const isHashLike = (hash: string): boolean => /^v\d+:[0-9a-f]{12,64}$/.test(hash);

/** ISO timestamp to minute precision: 2026-09-15T14:03Z. */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16) + "Z";
}

/** Drop null, undefined, empty arrays/objects and false booleans (defaults), recursively. */
export function dropEmpty<T>(value: T): T | undefined {
  if (value === null || value === undefined || value === false || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(v => dropEmpty(v)).filter(v => v !== undefined);
    return (items.length > 0 ? items : undefined) as T | undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = dropEmpty(v);
      if (c !== undefined) out[k] = c;
    }
    return (Object.keys(out).length > 0 ? out : undefined) as T | undefined;
  }
  return value;
}

/** Minified JSON with empty fields dropped. */
export function compactJson(value: unknown): string {
  return JSON.stringify(dropEmpty(value) ?? {});
}

export interface Truncated {
  text: string;
  shown: number;
  total: number;
  /** Index of the first item not shown, or null when everything fit. */
  next: number | null;
}

/**
 * Join rendered items until `maxChars` would be exceeded. Never cuts an item; always shows at least one.
 * `start` is the offset of items[0] in the full list, so `next` is an index into the full list.
 */
export function truncateItems(items: string[], maxChars: number, sep = "\n", start = 0): Truncated {
  let used = 0;
  let count = 0;
  for (const item of items) {
    const cost = item.length + (count > 0 ? sep.length : 0);
    if (count > 0 && used + cost > maxChars) break;
    used += cost;
    count++;
  }
  return {
    text: items.slice(0, count).join(sep),
    shown: count,
    total: items.length,
    next: count < items.length ? start + count : null,
  };
}

const STYLE_PAD = 14;

/** One element line: `el_... Action      | text`. Soft returns continue on indented lines. */
export function renderElementLine(e: ElementView, withHash = false): string {
  const [first = "", ...rest] = e.text.split("\n");
  const pad = " ".repeat(e.id.length + 1 + STYLE_PAD);
  const hash = withHash && e.contentHash ? ` [${shortHash(e.contentHash)}]` : "";
  const head = `${e.id} ${e.styleName.padEnd(STYLE_PAD)}| ${first}${hash}`;
  return [head, ...rest.map(r => `${pad}| ${r}`)].join("\n");
}

/** Scene header line: `SCENE el_... #42 hash=v1:abc "INT. X - DAY"`. */
export function renderSceneHeader(s: { id: string; number: string | null; heading: string; contentHash: string; omitted?: boolean | undefined }): string {
  const num = s.number ? ` #${s.number}` : "";
  if (s.omitted) return `SCENE ${s.id}${num} OMITTED`;
  return `SCENE ${s.id}${num} hash=${shortHash(s.contentHash)} "${s.heading}"`;
}

/**
 * The `lines` format for one scene (spec 07 8.2). The scene heading element is the header line (its id
 * is the scene id); its own row is not repeated. Element hashes are omitted to save space (use
 * get_elements for them).
 */
export function renderScene(s: SceneView): string {
  const out: string[] = [renderSceneHeader(s)];
  if (s.synopsis) out.push(`  synopsis: ${s.synopsis.replace(/\n/g, " ")}`);
  for (const e of s.elements) {
    if (e.id === s.id) continue;
    out.push(renderElementLine(e));
  }
  return out.join("\n");
}

/** Outline row: `1 el_... "INT. X - DAY" v1:abc 5 els | synopsis`. */
export function renderOutlineLine(s: OutlineSceneView, index: number): string {
  const num = s.number ?? String(index + 1);
  if (s.omitted) return `${num} ${s.id} OMITTED`;
  const syn = s.synopsis ? ` | ${s.synopsis.replace(/\n/g, " ")}` : "";
  return `${num} ${s.id} "${s.heading}" ${shortHash(s.contentHash)} ${s.elementCount} els${syn}`;
}

/** A footer telling the model exactly how to fetch the rest. */
export function nextFooter(tool: string, args: Record<string, unknown>, shown: number, total: number): string {
  return `-- truncated: showing ${shown} of ${total}. Fetch the rest with ${tool} ${JSON.stringify(args)} --`;
}
