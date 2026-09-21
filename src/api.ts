/**
 * @fileoverview Typed calls over the REST client shared by the tools: reads with paging, the style
 * cache, key-scope probing, hash expansion and the one command-batch write path. Only HTTP; no
 * writing_core.
 */
import * as client from "./client.ts";
import { ApiError, seg } from "./client.ts";
import { READ_ONLY_MESSAGE, ToolError } from "./errors.ts";
import { isFullHash, shortHash, type ElementView, type OutlineSceneView, type SceneView } from "./compact.ts";
import { normalizeId, resolveSceneRef, type StyleInfo } from "./refs.ts";
import type { Command } from "./commands.ts";

// ---- Response shapes (local mirror of screenwriter_types, checked by the smoke test) ----

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Me {
  userId: string;
  email: string | null;
  displayName: string | null;
  personalWorkspaceId: string;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  kind: string;
  role: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  updatedAt: string;
}

export interface DocumentMetaView {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  language: string;
  templateId: string | null;
  epoch: number;
  pageCount: number;
  sceneCount: number;
  wordCount: number;
  parentSnapshotId: string | null;
  updatedAt: string;
  lastEditedAt: string | null;
}

export interface DocumentDetailView extends DocumentMetaView {
  template: {
    id: string;
    version: number;
    name: string;
    layoutMode: string;
    styles: { id: string; name: string; code: number | null; enter: string | null; tab: string | null }[];
  } | null;
}

export interface BatchResponse {
  applied: number;
  epoch: number;
  dryRun?: boolean;
  effects: { createdIds: string[]; changedIds: string[]; deletedIds: string[]; newHashes: Record<string, string> };
  warnings: { index: number; code: string; message: string }[];
}

interface SceneReadRaw {
  id: string;
  number: string | null;
  heading: string;
  synopsis: string;
  contentHash: string;
  elements: { id: string; styleId: string; styleName: string; text: string; contentHash: string }[];
}

// ---- Discovery ----

export const getMe = () => client.get<Me>("/me");
export const getWorkspaces = () => client.get<Paginated<WorkspaceItem>>("/workspaces");
export const getDocument = (did: string) => client.get<DocumentDetailView>(`/documents/${seg(did)}`);

let workspaceIdCache: string | undefined;
/** The key's workspace (a key sees exactly one). */
export async function getWorkspaceId(): Promise<string> {
  if (workspaceIdCache) return workspaceIdCache;
  const ws = await getWorkspaces();
  const first = ws.items[0];
  if (!first) throw new ToolError("This key sees no workspace.");
  workspaceIdCache = first.id;
  return first.id;
}

let scopeCache: "read" | "read_write" | undefined;
/**
 * The API has no key-introspection route, so probe: a write to a non-existent document is refused 403
 * FORBIDDEN by a `read` key before routing and 404 NOT_FOUND by a `read_write` key. Cached.
 */
export async function getScope(): Promise<"read" | "read_write"> {
  if (scopeCache) return scopeCache;
  try {
    await client.post(`/documents/doc_00000000000000000000000000/restore`);
    scopeCache = "read_write";
  } catch (error) {
    if (error instanceof ApiError && error.code === "FORBIDDEN") scopeCache = "read";
    else if (error instanceof ApiError && error.status > 0 && error.code !== "UNAUTHORIZED") scopeCache = "read_write";
    else throw error;
  }
  return scopeCache;
}

/** For tests: forget cached facts. */
export function resetCaches(): void {
  workspaceIdCache = undefined;
  scopeCache = undefined;
  styleCache.clear();
}

// ---- Styles ----

const styleCache = new Map<string, StyleInfo[]>();
export async function getStyles(did: string, refresh = false): Promise<StyleInfo[]> {
  const cached = styleCache.get(did);
  if (cached && !refresh) return cached;
  const doc = await getDocument(did);
  const styles = (doc.template?.styles ?? []).map(s => ({ id: s.id, name: s.name, code: s.code }));
  styleCache.set(did, styles);
  return styles;
}

// ---- Reads ----

export async function getOutlineScenes(did: string): Promise<OutlineSceneView[]> {
  const r = await client.get<{ scenes: OutlineSceneView[] }>(`/documents/${seg(did)}/outline`);
  return r.scenes;
}

const toSceneView = (s: SceneReadRaw): SceneView => ({
  id: s.id,
  number: s.number,
  heading: s.heading,
  synopsis: s.synopsis,
  contentHash: s.contentHash,
  elements: s.elements.map(e => ({ id: e.id, styleName: e.styleName, text: e.text, contentHash: e.contentHash })),
});

/** Fetch scenes by heading id, in the order given, 20 per request. */
export async function getScenes(did: string, sceneIds: string[]): Promise<SceneView[]> {
  const out: SceneView[] = [];
  for (let i = 0; i < sceneIds.length; i += 20) {
    const chunk = sceneIds.slice(i, i + 20);
    const r = await client.post<{ scenes: SceneReadRaw[] }>(`/documents/${seg(did)}/scenes/batch`, { body: { sceneIds: chunk } });
    out.push(...r.scenes.map(toSceneView));
  }
  return out;
}

export async function getElements(did: string, elementIds: string[]): Promise<ElementView[]> {
  const out: ElementView[] = [];
  for (let i = 0; i < elementIds.length; i += 500) {
    const chunk = elementIds.slice(i, i + 500);
    const r = await client.post<{ elements: { id: string; styleId: string; styleName: string; text: string; contentHash: string }[] }>(
      `/documents/${seg(did)}/elements/batch`,
      { body: { elementIds: chunk } }
    );
    out.push(...r.elements.map(e => ({ id: e.id, styleName: e.styleName, text: e.text, contentHash: e.contentHash })));
  }
  return out;
}

/** Resolve scene refs against a fresh outline. */
export async function resolveScenes(did: string, refs: string[]): Promise<{ scenes: OutlineSceneView[]; outline: OutlineSceneView[] }> {
  const outline = await getOutlineScenes(did);
  return { outline, scenes: refs.map(r => resolveSceneRef(outline, r)) };
}

// ---- Writes ----

/**
 * Turn hashes from the read tools (full, or `v1:` + 12 hex) into full hashes for `expectedHashes`.
 * A short hash is matched by prefix against the CURRENT hash of that scene or element; no match means
 * the text has changed since it was read, so the write is refused locally with the same message the
 * API gives. (The server still re-checks the full hash atomically.)
 */
export async function expandHashes(did: string, hashes: Record<string, string> | undefined): Promise<Record<string, string> | undefined> {
  if (!hashes) return undefined;
  const entries = Object.entries(hashes).map(([id, h]) => [normalizeId(id), h] as const);
  const out: Record<string, string> = {};
  const short = entries.filter(([, h]) => !isFullHash(h));
  for (const [id, h] of entries) if (isFullHash(h)) out[id] = h;
  if (short.length > 0) {
    const [outline, elements] = await Promise.all([
      getOutlineScenes(did),
      getElementsLenient(did, short.map(([id]) => id)),
    ]);
    const stale: string[] = [];
    for (const [id, h] of short) {
      const cands = [outline.find(s => s.id === id)?.contentHash, elements.get(id)].filter((x): x is string => !!x);
      const match = cands.find(c => c.startsWith(h));
      if (match) out[id] = match;
      else stale.push(id); // no current hash starts with it: the text changed (or the id is gone)
    }
    if (stale.length > 0) {
      throw new ApiError("Content changed since it was read", 409, "CONTENT_CHANGED", { ids: stale });
    }
  }
  return out;
}

/** Element hashes by id, skipping ids that do not exist as elements (they may be scene-only). */
async function getElementsLenient(did: string, ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  try {
    for (const e of await getElements(did, ids)) if (e.contentHash) found.set(e.id, e.contentHash);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
    // Some ids are missing: fetch one by one so the rest still resolve.
    for (const id of ids) {
      try {
        for (const e of await getElements(did, [id])) if (e.contentHash) found.set(e.id, e.contentHash);
      } catch {
        /* missing */
      }
    }
  }
  return found;
}

export interface BatchOptions {
  expectedHashes?: Record<string, string> | undefined;
  dryRun?: boolean | undefined;
}

/** THE write path: one command batch with the current epoch. */
export async function applyBatch(did: string, commands: Command[], opts: BatchOptions = {}): Promise<BatchResponse> {
  if (!opts.dryRun && (await getScope()) === "read") throw new ToolError(READ_ONLY_MESSAGE);
  const doc = await getDocument(did);
  const expectedHashes = await expandHashes(did, opts.expectedHashes);
  return client.post<BatchResponse>(`/documents/${seg(did)}/commands`, {
    body: {
      commands,
      baseEpoch: doc.epoch,
      ...(expectedHashes && Object.keys(expectedHashes).length > 0 ? { expectedHashes } : {}),
      ...(opts.dryRun ? { dryRun: true } : {}),
    },
  });
}

export { shortHash };
