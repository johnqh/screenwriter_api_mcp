/**
 * @fileoverview Reading tools: get_outline, get_scene, get_scenes, get_elements, read_script, search_document.
 * All output is compact text (see compact.ts); large results are capped and say how to fetch the rest.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "../api.ts";
import {
  nextFooter,
  renderElementLine,
  renderOutlineLine,
  renderScene,
  shortHash,
  truncateItems,
  type SceneView,
} from "../compact.ts";
import { ToolError } from "../errors.ts";
import { normalizeId, resolveSceneRef } from "../refs.ts";
import { READ, documentId, elementId, json, maxChars, run, sceneRef, text } from "./util.ts";

const sceneToJson = (s: SceneView) => ({
  id: s.id,
  number: s.number,
  heading: s.heading,
  synopsis: s.synopsis,
  hash: shortHash(s.contentHash),
  elements: s.elements.map(e => ({ id: e.id, style: e.styleName, text: e.text, hash: shortHash(e.contentHash) })),
});

const format = z.enum(["lines", "json"]).optional().describe("'lines' (default): compact screenplay text with element ids; 'json': structured");

/** Render a page of scenes for the script dump: capped, boundaries at scenes. */
export function renderScenesCapped(
  scenes: SceneView[],
  ceiling: number,
  start: number
): { body: string; shown: number; next: number | null } {
  const t = truncateItems(scenes.map(renderScene), ceiling, "\n\n", start);
  return { body: t.text, shown: t.shown, next: t.next };
}

export function registerReadTools(server: McpServer) {
  server.registerTool(
    "get_outline",
    {
      description:
        "The script's scenes in order (GET /documents/:did/outline). One line per scene: number, scene id, heading, short " +
        "content hash, element count, synopsis; omitted scenes are marked OMITTED. No element text. Paged: pass `from` " +
        "(0-based scene index) to continue. Example: get_outline({ documentId: 'doc_...' })",
      inputSchema: { documentId, from: z.number().int().min(0).optional().describe("Start at this 0-based scene index") },
      annotations: READ,
    },
    async ({ documentId: did, from }) =>
      run(async () => {
        const scenes = await api.getOutlineScenes(did);
        const start = from ?? 0;
        const lines = scenes.slice(start).map((s, i) => renderOutlineLine(s, start + i));
        const t = truncateItems(lines, maxChars(), "\n", start);
        const head = `OUTLINE ${did}: ${scenes.length} scenes`;
        const foot = t.next !== null ? "\n" + nextFooter("get_outline", { documentId: did, from: t.next }, t.shown, lines.length) : "";
        return text(`${head}\n${t.text}${foot}`);
      })
  );

  server.registerTool(
    "get_scene",
    {
      description:
        "One scene's elements (GET /documents/:did/scenes/:sceneId after resolving sceneRef via the outline). Default `lines` " +
        "format reads like a screenplay: `el_id Style | text`, header shows the scene id and hash. Use element ids and the " +
        "scene hash in write tools. Example: get_scene({ documentId: 'doc_...', sceneRef: '#2' })",
      inputSchema: { documentId, sceneRef, format },
      annotations: READ,
    },
    async ({ documentId: did, sceneRef: ref, format: fmt }) =>
      run(async () => {
        const { scenes } = await api.resolveScenes(did, [ref]);
        const [scene] = await api.getScenes(did, [scenes[0]!.id]);
        return fmt === "json" ? json(sceneToJson(scene!)) : text(renderScene(scene!));
      })
  );

  server.registerTool(
    "get_scenes",
    {
      description:
        "Several scenes at once (POST /documents/:did/scenes/batch), up to 20 refs, or a range from/to. Same formats as " +
        "get_scene, capped with a footer saying how to continue. Example: get_scenes({ documentId: 'doc_...', sceneRefs: ['@1','@2'] })",
      inputSchema: {
        documentId,
        sceneRefs: z.array(sceneRef).max(20).optional(),
        range: z.object({ from: sceneRef, to: sceneRef }).optional().describe("Inclusive range of scenes, at most 20"),
        format,
      },
      annotations: READ,
    },
    async ({ documentId: did, sceneRefs, range, format: fmt }) =>
      run(async () => {
        const outline = await api.getOutlineScenes(did);
        let ids: string[];
        if (range) {
          const a = outline.findIndex(s => s.id === resolveSceneRef(outline, range.from).id);
          const b = outline.findIndex(s => s.id === resolveSceneRef(outline, range.to).id);
          if (b < a) throw new ToolError("range.to comes before range.from");
          if (b - a + 1 > 20) throw new ToolError(`RANGE_TOO_LARGE: ${b - a + 1} scenes; at most 20 per call. Use read_script to page through a whole script.`);
          ids = outline.slice(a, b + 1).map(s => s.id);
        } else if (sceneRefs && sceneRefs.length > 0) {
          ids = sceneRefs.map(r => resolveSceneRef(outline, r).id);
        } else {
          throw new ToolError("Give sceneRefs or range.");
        }
        const scenes = await api.getScenes(did, ids);
        if (fmt === "json") return json({ scenes: scenes.map(sceneToJson) });
        const t = truncateItems(scenes.map(renderScene), maxChars(), "\n\n");
        const foot =
          t.next !== null
            ? "\n\n" + nextFooter("get_scenes", { documentId: did, sceneRefs: ids.slice(t.next) }, t.shown, scenes.length)
            : "";
        return text(t.text + foot);
      })
  );

  server.registerTool(
    "get_elements",
    {
      description:
        "Elements by id with their style, text and content hash (POST /documents/:did/elements/batch). Use it to get the " +
        "hashes for `expectedHashes`. Up to 500 ids. Example: get_elements({ documentId: 'doc_...', elementIds: ['el_...'] })",
      inputSchema: { documentId, elementIds: z.array(elementId).min(1).max(500) },
      annotations: READ,
    },
    async ({ documentId: did, elementIds }) =>
      run(async () => {
        const els = await api.getElements(did, elementIds.map(normalizeId));
        const lines = els.map(e => renderElementLine(e, true));
        const t = truncateItems(lines, maxChars());
        return text(
          t.text +
            (t.next !== null ? "\n" + nextFooter("get_elements", { documentId: did, elementIds: elementIds.slice(t.next) }, t.shown, lines.length) : "")
        );
      })
  );

  server.registerTool(
    "read_script",
    {
      description:
        "Read the whole script as compact screenplay text, in chunks (outline + POST /documents/:did/scenes/batch). Each call " +
        "returns whole scenes up to a size cap plus a `nextCursor`; call again with it until it is null. Example: " +
        "read_script({ documentId: 'doc_...' }) then read_script({ documentId: 'doc_...', cursor: '8' })",
      inputSchema: {
        documentId,
        cursor: z.string().optional().describe("nextCursor from the previous call (a scene index); omit to start"),
        maxScenes: z.number().int().min(1).max(20).optional().describe("Scenes per call (default 10, max 20)"),
      },
      annotations: READ,
    },
    async ({ documentId: did, cursor, maxScenes }) =>
      run(async () => {
        const outline = await api.getOutlineScenes(did);
        const start = cursor ? parseInt(cursor, 10) : 0;
        if (!Number.isFinite(start) || start < 0) throw new ToolError(`Bad cursor '${cursor}'. Use the nextCursor from the previous read_script call.`);
        const slice = outline.slice(start, start + (maxScenes ?? 10));
        if (slice.length === 0 && start > 0) return text(`SCRIPT ${did}: end (${outline.length} scenes). nextCursor: null`);
        const scenes = await api.getScenes(
          did,
          slice.map(s => s.id)
        );
        const { body, shown, next } = renderScenesCapped(scenes, maxChars(), start);
        const following = next !== null ? next : start + slice.length < outline.length ? start + slice.length : null;
        const head = `SCRIPT ${did}: scenes ${start + 1}-${start + shown} of ${outline.length}`;
        return text(`${head}\n\n${body}\n\nnextCursor: ${following === null ? "null" : `"${following}"`}`);
      })
  );

  server.registerTool(
    "search_document",
    {
      description:
        "Search the script text. The API has no search route yet, so this reads the scenes (POST /documents/:did/scenes/batch) " +
        "and matches client-side: case-insensitive substring, or a regex with mode 'regex'. Returns scene number, element id, " +
        "style and a snippet. Example: search_document({ documentId: 'doc_...', query: 'MILLER' })",
      inputSchema: {
        documentId,
        query: z.string().min(1),
        mode: z.enum(["text", "regex"]).optional(),
        styles: z.array(z.string()).optional().describe("Only these style names, e.g. ['Dialogue']"),
        limit: z.number().int().min(1).max(100).optional().describe("Max matches (default 30)"),
      },
      annotations: READ,
    },
    async ({ documentId: did, query, mode, styles, limit }) =>
      run(async () => {
        let re: RegExp;
        try {
          re = mode === "regex" ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        } catch (e) {
          throw new ToolError(`VALIDATION: bad regex: ${e instanceof Error ? e.message : String(e)}`);
        }
        const wanted = styles?.map(s => s.toLowerCase());
        const cap = limit ?? 30;
        const outline = await api.getOutlineScenes(did);
        const hits: string[] = [];
        let total = 0;
        for (let i = 0; i < outline.length; i += 20) {
          const scenes = await api.getScenes(did, outline.slice(i, i + 20).map(s => s.id));
          for (const [k, s] of scenes.entries()) {
            const num = s.number ?? String(i + k + 1);
            const rows = s.elements.some(e => e.id === s.id) ? s.elements : [{ id: s.id, styleName: "Scene Heading", text: s.heading }, ...s.elements];
            for (const e of rows) {
              if (wanted && !wanted.includes(e.styleName.toLowerCase())) continue;
              const m = re.exec(e.text);
              if (!m) continue;
              total++;
              if (hits.length < cap) {
                const a = Math.max(0, m.index - 40);
                const b = Math.min(e.text.length, m.index + m[0].length + 40);
                const snip = (a > 0 ? "..." : "") + e.text.slice(a, b).replace(/\n/g, " ") + (b < e.text.length ? "..." : "");
                hits.push(`#${num} ${e.id} ${e.styleName} | ${snip}`);
              }
            }
          }
        }
        const head = `SEARCH '${query}': ${total} match${total === 1 ? "" : "es"}${total > hits.length ? ` (showing ${hits.length}; raise limit or narrow the query)` : ""}`;
        return text([head, ...hits].join("\n"));
      })
  );
}

