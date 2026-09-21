/**
 * @fileoverview Snapshot tools: list_snapshots, create_snapshot, fork_snapshot.
 * DELIBERATELY WITHHELD: open_snapshot / restore_version. Opening a snapshot replaces the writer's
 * live content (the API bumps the epoch and closes open editors); that is too destructive to hand an
 * assistant by default. Use fork_snapshot to try a branch as a NEW document instead.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { seg } from "../client.ts";
import * as api from "../api.ts";
import { READ, WRITE, documentId, json, run, text } from "./util.ts";
import { shortTime } from "../compact.ts";
import { READ_ONLY_MESSAGE, ToolError } from "../errors.ts";

interface SnapshotRow {
  id: string;
  parentId: string | null;
  name: string;
  note: string | null;
  kind: string;
  autoReason: string | null;
  stats: { pages: number; scenes: number; words: number };
  createdAt: string;
  forkedDocumentIds: string[];
}

export function registerSnapshotTools(server: McpServer) {
  server.registerTool(
    "list_snapshots",
    {
      description:
        "List a document's snapshots, newest first (GET /documents/:did/snapshots): id, name, note, kind, when, size, parent. " +
        "Automatic snapshots are hidden unless includeAutomatic. Example: list_snapshots({ documentId: 'doc_...' })",
      inputSchema: { documentId, includeAutomatic: z.boolean().optional() },
      annotations: READ,
    },
    async ({ documentId: did, includeAutomatic }) =>
      run(async () => {
        const r = await client.get<{ liveParentSnapshotId: string | null; snapshots: SnapshotRow[] }>(
          `/documents/${seg(did)}/snapshots`,
          { query: { includeAutomatic: includeAutomatic ? "true" : "false" } }
        );
        return json({
          liveParent: r.liveParentSnapshotId,
          snapshots: r.snapshots.map(s => ({
            id: s.id,
            name: s.name,
            note: s.note,
            kind: s.kind === "manual" ? undefined : s.kind,
            reason: s.autoReason,
            parent: s.parentId,
            at: shortTime(s.createdAt),
            scenes: s.stats.scenes,
            pages: s.stats.pages,
            forks: s.forkedDocumentIds,
          })),
        });
      })
  );

  server.registerTool(
    "create_snapshot",
    {
      description:
        "Save an immutable snapshot of the document as it is now (POST /documents/:did/snapshots). Take one before a risky " +
        "rewrite so the writer can compare or branch. Needs read_write. Example: create_snapshot({ documentId: 'doc_...', name: 'Before act 2 rewrite', note: 'tightening dialogue' })",
      inputSchema: { documentId, name: z.string().min(1).max(120), note: z.string().max(2000).optional() },
      annotations: WRITE,
    },
    async ({ documentId: did, name, note }) =>
      run(async () => {
        if ((await api.getScope()) === "read") throw new ToolError(READ_ONLY_MESSAGE);
        const s = await client.post<SnapshotRow>(`/documents/${seg(did)}/snapshots`, { body: { name, ...(note ? { note } : {}) } });
        return json({ snapshotId: s.id, name: s.name, at: shortTime(s.createdAt), scenes: s.stats.scenes, pages: s.stats.pages });
      }, { write: true })
  );

  server.registerTool(
    "fork_snapshot",
    {
      description:
        "Try a different branch: create a NEW document from a snapshot (POST /snapshots/:sid/fork). The original document is " +
        "untouched; the fork is a separate script the writer can open. Needs read_write. Example: fork_snapshot({ snapshotId: 'snap_...', title: 'Draft 2, darker ending' })",
      inputSchema: { snapshotId: z.string().describe("Snapshot ID (snap_..., from list_snapshots)"), title: z.string().min(1).max(200), projectId: z.string().optional().describe("Put the fork in another project (default: same project)") },
      annotations: WRITE,
    },
    async ({ snapshotId, title, projectId }) =>
      run(async () => {
        if ((await api.getScope()) === "read") throw new ToolError(READ_ONLY_MESSAGE);
        const d = await client.post<api.DocumentMetaView>(`/snapshots/${seg(snapshotId)}/fork`, {
          body: { title, ...(projectId ? { targetProjectId: projectId } : {}) },
        });
        return json({ documentId: d.id, title: d.title, projectId: d.projectId, epoch: d.epoch, forkedFromSnapshot: snapshotId });
      }, { write: true })
  );
}
