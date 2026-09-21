/**
 * @fileoverview Client-side resolution of scene references and style names. The API has no
 * locator-resolve route yet, so a small subset of spec 07 section 5 is resolved here against the
 * outline: raw scene id, scene number ('42', '#42', 'scene 12A'), ordinal ('@3'), heading text.
 */
import { ToolError } from "./errors.ts";
import type { OutlineSceneView } from "./compact.ts";

/** Crockford ids are case-insensitive: upper-case the body after the prefix. */
export function normalizeId(id: string): string {
  const m = /^([a-z]+)_(.+)$/i.exec(id.trim());
  return m ? `${m[1]!.toLowerCase()}_${m[2]!.toUpperCase()}` : id.trim();
}

export const looksLikeId = (s: string): boolean => /^[a-z]+_[0-9A-Za-z]{20,}$/.test(s.trim());

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const candidateList = (scenes: OutlineSceneView[], idx: number[]): string =>
  idx
    .slice(0, 10)
    .map(i => `${scenes[i]!.number ?? i + 1} ${scenes[i]!.id} "${scenes[i]!.heading}"`)
    .join("; ");

/** Resolve a sceneRef to the scene's heading element id. Never guesses: ambiguity is an error. */
export function resolveSceneRef(scenes: OutlineSceneView[], ref: string): OutlineSceneView {
  const raw = ref.trim();
  if (!raw) throw new ToolError("LOCATOR_SYNTAX: empty scene reference");
  if (looksLikeId(raw)) {
    const id = normalizeId(raw);
    const found = scenes.find(s => s.id === id);
    if (!found) throw new ToolError(`LOCATOR_NOT_FOUND: no scene with id ${id} (is it an element id rather than a scene heading id? use get_outline)`);
    return found;
  }
  const ordinal = /^(?:scene\s*)?@(\d+)$/i.exec(raw);
  if (ordinal) {
    const live = scenes.filter(s => !s.omitted);
    const n = parseInt(ordinal[1]!, 10);
    const found = live[n - 1];
    if (!found) throw new ToolError(`LOCATOR_NOT_FOUND: there are only ${live.length} non-omitted scenes (asked for @${n})`);
    return found;
  }
  const numeric = /^(?:#|scene\s+|sc\s+)?([0-9]+[A-Za-z]{0,2}|[A-Za-z][0-9]+)$/i.exec(raw);
  if (numeric) {
    const wanted = numeric[1]!.toLowerCase();
    const idx = scenes.map((s, i) => (s.number && s.number.toLowerCase() === wanted ? i : -1)).filter(i => i >= 0);
    if (idx.length === 1) return scenes[idx[0]!]!;
    if (idx.length > 1) throw new ToolError(`LOCATOR_AMBIGUOUS: '${ref}' matches several scenes: ${candidateList(scenes, idx)}. Use an id.`);
    // Unnumbered documents show the ordinal as the number (see get_outline).
    if (/^[0-9]+$/.test(wanted) && scenes.every(s => !s.number)) {
      const found = scenes[parseInt(wanted, 10) - 1];
      if (found) return found;
    }
    if (!/^[0-9]+$/.test(wanted) || /^(#|scene|sc)/i.test(raw)) {
      throw new ToolError(`LOCATOR_NOT_FOUND: no scene numbered ${numeric[1]}`);
    }
  }
  const q = norm(raw.replace(/^"|"$/g, ""));
  const exact = scenes.map((s, i) => (norm(s.heading) === q ? i : -1)).filter(i => i >= 0);
  if (exact.length === 1) return scenes[exact[0]!]!;
  const partial = exact.length > 1 ? exact : scenes.map((s, i) => (norm(s.heading).includes(q) ? i : -1)).filter(i => i >= 0);
  if (partial.length === 1) return scenes[partial[0]!]!;
  if (partial.length > 1) throw new ToolError(`LOCATOR_AMBIGUOUS: '${ref}' matches ${partial.length} scenes: ${candidateList(scenes, partial)}. Retry with a scene id.`);
  throw new ToolError(`LOCATOR_NOT_FOUND: no scene matches '${ref}'. Use get_outline to see scene ids, numbers and headings.`);
}

export interface StyleInfo {
  id: string;
  name: string;
  code: number | null;
}

/** Resolve a style id, name or shortcut code to a StyleId. */
export function resolveStyle(styles: StyleInfo[], ref: string): StyleInfo {
  const q = ref.trim();
  const byId = styles.find(s => s.id === q);
  if (byId) return byId;
  const byName = styles.find(s => norm(s.name) === norm(q));
  if (byName) return byName;
  if (/^\d+$/.test(q)) {
    const byCode = styles.find(s => s.code !== null && String(s.code) === q);
    if (byCode) return byCode;
  }
  throw new ToolError(
    `STYLE_UNKNOWN: '${ref}' is not a style in this document's template. Valid styles: ${styles.map(s => s.name).join(", ")}.`
  );
}

/** The template's scene heading style: named like a slugline. */
export function findSceneHeadingStyle(styles: StyleInfo[]): StyleInfo {
  const found =
    styles.find(s => norm(s.name) === "scene heading") ??
    styles.find(s => /scene heading|slugline|slug line/i.test(s.name));
  if (!found) throw new ToolError(`STYLE_UNKNOWN: this template has no scene heading style. Valid styles: ${styles.map(s => s.name).join(", ")}.`);
  return found;
}
