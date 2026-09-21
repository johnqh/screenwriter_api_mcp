/**
 * @fileoverview Writing tools. Every tool compiles to ONE command batch sent to
 * POST /documents/:did/commands with the current baseEpoch (spec 07 section 6.4). The `X-Client`
 * header (added by client.ts) makes the API record these edits as MCP-origin.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "../api.ts";
import * as cmd from "../commands.ts";
import { shortHash } from "../compact.ts";
import { ToolError } from "../errors.ts";
import { normalizeId, resolveStyle, findSceneHeadingStyle } from "../refs.ts";
import {
  DESTRUCTIVE,
  WRITE,
  documentId,
  dryRun,
  elementId,
  expectedHash,
  expectedHashes,
  run,
  sceneRef,
  text,
} from "./util.ts";

const preview = (s: string, n = 50): string => {
  const one = s.replace(/\n/g, " ");
  return one.length > n ? `${one.slice(0, n)}...` : one;
};

/** Compact report of a batch: counts, ids, new epoch, new hashes, warnings. */
export function formatBatch(r: api.BatchResponse, extra: string[] = []): string {
  const e = r.effects;
  const head = r.dryRun
    ? `DRY RUN (nothing was changed): ${e.createdIds.length} would be created, ${e.changedIds.length} changed, ${e.deletedIds.length} deleted.`
    : `APPLIED ${r.applied} command${r.applied === 1 ? "" : "s"}; epoch ${r.epoch}.`;
  const lines = [head];
  const list = (label: string, ids: string[]) => {
    if (ids.length > 0) lines.push(`${label} (${ids.length}): ${ids.slice(0, 30).join(", ")}${ids.length > 30 ? ", ..." : ""}`);
  };
  list("created", e.createdIds);
  list("changed", e.changedIds);
  list("deleted", e.deletedIds);
  const hashes = Object.entries(e.newHashes ?? {}).filter(([id]) => !e.deletedIds.includes(id));
  if (hashes.length > 0 && !r.dryRun) {
    lines.push(`new hashes: ${hashes.slice(0, 30).map(([id, h]) => `${id}=${shortHash(h)}`).join(" ")}${hashes.length > 30 ? " ..." : ""}`);
  }
  for (const w of r.warnings) lines.push(`warning: ${w.message} (${w.code})`);
  lines.push(...extra);
  return lines.join("\n");
}

const styledElement = z.object({
  style: z.string().describe("Style name or shortcut code from the template, e.g. 'Action', 'Character', 'Dialogue'"),
  text: z.string().describe("Text as typed (capitalisation of Character/Scene Heading comes from the style; do not upper-case yourself)"),
});

const position = z
  .object({
    afterElementId: elementId.optional(),
    beforeElementId: elementId.optional(),
    atEndOfScene: sceneRef.optional(),
    atEndOfDocument: z.boolean().optional(),
  })
  .describe("Exactly one of afterElementId, beforeElementId, atEndOfScene, atEndOfDocument");

/** Match created ids back to the requested items by (style name, text), in order. */
async function describeCreated(did: string, created: string[], items: { styleName: string; text: string }[]): Promise<string[]> {
  if (created.length === 0) return [];
  const els = await api.getElements(did, created);
  const pool = [...els];
  const ordered: string[] = [];
  for (const it of items) {
    const i = pool.findIndex(e => e.styleName === it.styleName && e.text === it.text);
    if (i >= 0) {
      const e = pool.splice(i, 1)[0]!;
      ordered.push(`${e.id} ${e.styleName} [${shortHash(e.contentHash)}] ${preview(e.text)}`);
    }
  }
  for (const e of pool) ordered.push(`${e.id} ${e.styleName} [${shortHash(e.contentHash)}] ${preview(e.text)}`);
  return ["new elements in order:", ...ordered.map(o => `  ${o}`)];
}

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    "replace_element_text",
    {
      description:
        "Replace the text of one element (POST /documents/:did/commands, text.replaceRange). Whole element by default, or a " +
        "character `range` {start,end} (UTF-16 offsets). Guarded: it is refused with CONTENT_CHANGED if the element changed " +
        "since `expectedHash` (or since this call read it). Needs a read_write key. Failures: CONTENT_CHANGED, COMMAND_INVALID, " +
        "EPOCH_MISMATCH. Example: replace_element_text({ documentId: 'doc_...', elementId: 'el_...', text: 'You are late.' })",
      inputSchema: {
        documentId,
        elementId,
        text: z.string(),
        range: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
        expectedHash,
        dryRun,
      },
      annotations: WRITE,
    },
    async ({ documentId: did, elementId: rawId, text: newText, range, expectedHash: hash, dryRun: dry }) =>
      run(async () => {
        const id = normalizeId(rawId);
        const [el] = await api.getElements(did, [id]);
        if (!el) throw new ToolError(`NOT_FOUND: element ${id}`);
        const start = range?.start ?? 0;
        const end = range?.end ?? el.text.length;
        if (start > end || end > el.text.length) {
          throw new ToolError(`Range ${start}-${end} is outside the element (length ${el.text.length}). Re-read it with get_elements.`);
        }
        const r = await api.applyBatch(did, [cmd.replaceText(id, start, end, newText)], {
          // No hash from the caller: still guard against a race between this read and the write.
          expectedHashes: { [id]: hash ?? el.contentHash ?? "" },
          dryRun: dry,
        });
        return text(formatBatch(r));
      }, { write: true })
  );

  server.registerTool(
    "insert_elements",
    {
      description:
        "Insert elements (style + text) after or before an element, at the end of a scene, or at the end of the document, in one " +
        "atomic batch (POST /documents/:did/commands, element.insert x n). Styles come from the template (get_document). " +
        "Returns the new element ids in order. Needs read_write. Failures: STYLE_UNKNOWN, CONTENT_CHANGED, COMMAND_INVALID. " +
        "Example: insert_elements({ documentId: 'doc_...', position: { afterElementId: 'el_...' }, elements: [{ style: 'Character', text: 'MILLER' }, { style: 'Dialogue', text: 'Sit down.' }] })",
      inputSchema: { documentId, position, elements: z.array(styledElement).min(1).max(200), expectedHash, dryRun },
      annotations: WRITE,
    },
    async ({ documentId: did, position: pos, elements, expectedHash: hash, dryRun: dry }) =>
      run(async () => {
        const chosen = [pos.afterElementId, pos.beforeElementId, pos.atEndOfScene, pos.atEndOfDocument ? "end" : undefined].filter(
          x => x !== undefined
        );
        if (chosen.length !== 1) throw new ToolError("Give exactly one of position.afterElementId, beforeElementId, atEndOfScene, atEndOfDocument.");
        const styles = await api.getStyles(did);
        const items = elements.map(e => ({ style: resolveStyle(styles, e.style), text: e.text }));
        let anchor: cmd.Anchor;
        let guardId: string | undefined;
        if (pos.afterElementId) {
          guardId = normalizeId(pos.afterElementId);
          anchor = { after: guardId };
        } else if (pos.beforeElementId) {
          guardId = normalizeId(pos.beforeElementId);
          anchor = { before: guardId };
        } else if (pos.atEndOfScene) {
          const { scenes } = await api.resolveScenes(did, [pos.atEndOfScene]);
          const [scene] = await api.getScenes(did, [scenes[0]!.id]);
          const last = scene!.elements[scene!.elements.length - 1];
          anchor = { after: last ? last.id : scene!.id };
        } else {
          anchor = { end: true };
        }
        const commands = cmd.insertSequence(anchor, items.map(i => ({ style: i.style.id, text: i.text })));
        const r = await api.applyBatch(did, commands, {
          expectedHashes: hash && guardId ? { [guardId]: hash } : undefined,
          dryRun: dry,
        });
        const extra = r.dryRun ? [] : await describeCreated(did, r.effects.createdIds, items.map(i => ({ styleName: i.style.name, text: i.text })));
        return text(formatBatch(r, extra));
      }, { write: true })
  );

  server.registerTool(
    "delete_elements",
    {
      description:
        "Delete whole elements by id (POST /documents/:did/commands, one delete per element, one atomic batch). Deleting a scene " +
        "heading merges that scene into the previous one. Use dryRun first for anything large. Needs read_write. " +
        "Example: delete_elements({ documentId: 'doc_...', elementIds: ['el_...'], expectedHashes: { 'el_...': 'v1:...' } })",
      inputSchema: { documentId, elementIds: z.array(elementId).min(1).max(200), expectedHashes, dryRun },
      annotations: DESTRUCTIVE,
    },
    async ({ documentId: did, elementIds, expectedHashes: hashes, dryRun: dry }) =>
      run(async () => {
        const ids = elementIds.map(normalizeId);
        const r = await api.applyBatch(did, ids.map(cmd.deleteElement), { expectedHashes: hashes, dryRun: dry });
        return text(formatBatch(r));
      }, { write: true })
  );

  server.registerTool(
    "change_element_style",
    {
      description:
        "Change the style of elements, e.g. Action to Dialogue (POST /documents/:did/commands, element.setStyle). Style is a name " +
        "or code from the template. Needs read_write. Example: change_element_style({ documentId: 'doc_...', elementIds: ['el_...'], style: 'Parenthetical' })",
      inputSchema: { documentId, elementIds: z.array(elementId).min(1).max(200), style: z.string(), expectedHashes, dryRun },
      annotations: WRITE,
    },
    async ({ documentId: did, elementIds, style, expectedHashes: hashes, dryRun: dry }) =>
      run(async () => {
        const s = resolveStyle(await api.getStyles(did), style);
        const r = await api.applyBatch(did, [cmd.setStyle(elementIds.map(normalizeId), s.id)], { expectedHashes: hashes, dryRun: dry });
        return text(formatBatch(r, [`style is now ${s.name}`]));
      }, { write: true })
  );

  server.registerTool(
    "move_scenes",
    {
      description:
        "Move whole scenes to just after or just before another scene (POST /documents/:did/commands, scene.move). Scenes are " +
        "given as refs (id, number, @ordinal, heading). Scene numbers renumber if not locked. Needs read_write. " +
        "Example: move_scenes({ documentId: 'doc_...', sceneRefs: ['#3'], to: { afterSceneRef: '#1' } })",
      inputSchema: {
        documentId,
        sceneRefs: z.array(sceneRef).min(1).max(20),
        to: z.object({ afterSceneRef: sceneRef.optional(), beforeSceneRef: sceneRef.optional() }).describe("Exactly one of afterSceneRef, beforeSceneRef"),
        expectedHashes,
        dryRun,
      },
      annotations: WRITE,
    },
    async ({ documentId: did, sceneRefs, to, expectedHashes: hashes, dryRun: dry }) =>
      run(async () => {
        if ((to.afterSceneRef === undefined) === (to.beforeSceneRef === undefined)) {
          throw new ToolError("Give exactly one of to.afterSceneRef, to.beforeSceneRef.");
        }
        const { outline, scenes } = await api.resolveScenes(did, [...sceneRefs, (to.afterSceneRef ?? to.beforeSceneRef)!]);
        const target = scenes[scenes.length - 1]!;
        const moving = scenes.slice(0, -1);
        if (moving.some(s => s.id === target.id)) throw new ToolError("A scene cannot be moved relative to itself.");
        const dest = to.afterSceneRef !== undefined ? { after: target.id } : { before: target.id };
        const r = await api.applyBatch(did, [cmd.moveScenes(moving.map(s => s.id), dest)], { expectedHashes: hashes, dryRun: dry });
        const label = moving.map(s => s.heading).join("; ");
        return text(formatBatch(r, [`moved ${moving.length} scene${moving.length === 1 ? "" : "s"} (${preview(label, 80)}) ${to.afterSceneRef !== undefined ? "after" : "before"} "${target.heading}"; script has ${outline.length} scenes`]));
      }, { write: true })
  );

  server.registerTool(
    "set_scene_properties",
    {
      description:
        "Set a scene's properties (POST /documents/:did/commands, scene.setSynopsis). Only `synopsis` is supported so far " +
        "(colour and title are not built yet). Needs read_write. " +
        "Example: set_scene_properties({ documentId: 'doc_...', sceneRef: '#2', synopsis: 'Miller confronts Reyes.' })",
      inputSchema: { documentId, sceneRef, synopsis: z.string().optional().describe("New synopsis; empty string clears it"), expectedHash, dryRun },
      annotations: WRITE,
    },
    async ({ documentId: did, sceneRef: ref, synopsis, expectedHash: hash, dryRun: dry }) =>
      run(async () => {
        if (synopsis === undefined) throw new ToolError("Nothing to change: pass `synopsis` (colour and title are not supported yet).");
        const { scenes } = await api.resolveScenes(did, [ref]);
        const scene = scenes[0]!;
        const r = await api.applyBatch(did, [cmd.setSynopsis(scene.id, synopsis)], {
          expectedHashes: hash ? { [scene.id]: hash } : undefined,
          dryRun: dry,
        });
        return text(formatBatch(r, [`scene ${scene.id} "${scene.heading}" synopsis set`]));
      }, { write: true })
  );

  server.registerTool(
    "insert_scene",
    {
      description:
        "Insert a new scene: a scene heading plus optional first elements, placed after or before an existing scene, or at the " +
        "end (default). One atomic batch (POST /documents/:did/commands, element.insert x n); a `synopsis` is set in a second " +
        "batch. Returns the new scene id. Needs read_write. " +
        "Example: insert_scene({ documentId: 'doc_...', heading: 'INT. DINER - NIGHT', elements: [{ style: 'Action', text: 'Rain on the glass.' }], position: { afterSceneRef: '#1' } })",
      inputSchema: {
        documentId,
        heading: z.string().min(1).describe("Scene heading text, e.g. 'INT. DINER - NIGHT'"),
        elements: z.array(styledElement).max(100).optional().describe("Elements after the heading"),
        synopsis: z.string().optional(),
        position: z.object({ afterSceneRef: sceneRef.optional(), beforeSceneRef: sceneRef.optional() }).optional().describe("Default: end of the script"),
        dryRun,
      },
      annotations: WRITE,
    },
    async ({ documentId: did, heading, elements, synopsis, position: pos, dryRun: dry }) =>
      run(async () => {
        if (pos && pos.afterSceneRef !== undefined && pos.beforeSceneRef !== undefined) {
          throw new ToolError("Give at most one of position.afterSceneRef, position.beforeSceneRef.");
        }
        const styles = await api.getStyles(did);
        const headStyle = findSceneHeadingStyle(styles);
        const rest = (elements ?? []).map(e => ({ style: resolveStyle(styles, e.style), text: e.text }));
        const items = [{ style: headStyle, text: heading }, ...rest];
        let anchor: cmd.Anchor;
        if (pos?.afterSceneRef !== undefined) {
          const { scenes } = await api.resolveScenes(did, [pos.afterSceneRef]);
          const [scene] = await api.getScenes(did, [scenes[0]!.id]);
          const last = scene!.elements[scene!.elements.length - 1];
          anchor = { after: last ? last.id : scene!.id };
        } else if (pos?.beforeSceneRef !== undefined) {
          const { scenes } = await api.resolveScenes(did, [pos.beforeSceneRef]);
          anchor = { before: scenes[0]!.id };
        } else {
          anchor = { end: true };
        }
        const r = await api.applyBatch(did, cmd.insertSequence(anchor, items.map(i => ({ style: i.style.id, text: i.text }))), { dryRun: dry });
        if (r.dryRun) return text(formatBatch(r));
        const created = await api.getElements(did, r.effects.createdIds);
        const head = created.find(e => e.styleName === headStyle.name && e.text === heading);
        const extra: string[] = [];
        if (head) extra.push(`new scene id: ${head.id}`);
        if (synopsis && head) {
          const r2 = await api.applyBatch(did, [cmd.setSynopsis(head.id, synopsis)]);
          extra.push(`synopsis set (epoch ${r2.epoch})`);
        } else if (synopsis) {
          extra.push("warning: could not identify the new scene to set its synopsis; use set_scene_properties");
        }
        return text(formatBatch(r, extra));
      }, { write: true })
  );

  server.registerTool(
    "apply_commands",
    {
      description:
        "Escape hatch: send a raw writing_core command batch as-is (POST /documents/:did/commands), atomic, with the current " +
        "epoch. Each command is { id, params }, e.g. { id: 'element.setStyle', params: { elements: ['el_...'], style: 'sty_...' } }. " +
        "Prefer the intent tools; use dryRun to preview. Needs read_write unless dryRun. " +
        "Example: apply_commands({ documentId: 'doc_...', dryRun: true, commands: [{ id: 'scene.setSynopsis', params: { scene: 'el_...', value: 'x' } }] })",
      inputSchema: {
        documentId,
        commands: z.array(z.object({ id: z.string(), params: z.record(z.string(), z.unknown()).default({}) })).min(1).max(500),
        expectedHashes,
        dryRun,
      },
      annotations: DESTRUCTIVE,
    },
    async ({ documentId: did, commands, expectedHashes: hashes, dryRun: dry }) =>
      run(async () => {
        const r = await api.applyBatch(did, commands, { expectedHashes: hashes, dryRun: dry });
        return text(formatBatch(r));
      }, { write: true })
  );
}
