/**
 * @fileoverview Discovery tools: whoami, list_projects, list_documents, get_document.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import * as api from "../api.ts";
import { compactJson, shortTime } from "../compact.ts";
import { READ, documentId, json, run, text } from "./util.ts";

export function registerDiscoveryTools(server: McpServer) {
  server.registerTool(
    "whoami",
    {
      description:
        "Who this API key is (GET /me, GET /workspaces): user, the one workspace the key is scoped to, and the key's " +
        "scope ('read' or 'read_write'). Call this first. Example: whoami({})",
      inputSchema: {},
      annotations: READ,
    },
    async () =>
      run(async () => {
        const [me, ws, scope] = await Promise.all([api.getMe(), api.getWorkspaces(), api.getScope()]);
        const w = ws.items[0];
        const key = client.getConfig().apiKey ?? "";
        return json({
          user: { id: me.userId, email: me.email, name: me.displayName },
          workspace: w ? { id: w.id, name: w.name, kind: w.kind } : undefined,
          scope,
          readOnly: scope === "read" ? "This key cannot change scripts; write tools will refuse." : undefined,
          keyPrefix: key.slice(0, 12),
          apiUrl: client.getConfig().apiUrl,
        });
      })
  );

  server.registerTool(
    "list_projects",
    {
      description:
        "List the projects in the key's workspace (GET /workspaces/:wid/projects): id, name, documentCount, updatedAt. " +
        "Example: list_projects({})",
      inputSchema: { query: z.string().optional().describe("Name prefix filter") },
      annotations: READ,
    },
    async ({ query }) =>
      run(async () => {
        const wid = await api.getWorkspaceId();
        const r = await client.get<api.Paginated<api.ProjectItem>>(`/workspaces/${client.seg(wid)}/projects`, {
          query: { limit: 100, q: query },
        });
        return json({
          projects: r.items.map(p => ({ id: p.id, name: p.name, documents: p.documentCount, updated: shortTime(p.updatedAt) })),
          nextCursor: r.nextCursor,
        });
      })
  );

  server.registerTool(
    "list_documents",
    {
      description:
        "List the documents (scripts) in a project (GET /projects/:pid/documents): id, title, pages, scenes, epoch, updatedAt. " +
        "Example: list_documents({ projectId: 'prj_...' })",
      inputSchema: { projectId: z.string().describe("Project ID (prj_..., from list_projects)") },
      annotations: READ,
    },
    async ({ projectId }) =>
      run(async () => {
        const r = await client.get<api.Paginated<api.DocumentMetaView>>(`/projects/${client.seg(projectId)}/documents`, {
          query: { limit: 100 },
        });
        return json({
          documents: r.items.map(d => ({
            id: d.id,
            title: d.title,
            kind: d.kind,
            scenes: d.sceneCount,
            pages: d.pageCount,
            words: d.wordCount,
            updated: shortTime(d.updatedAt),
          })),
          nextCursor: r.nextCursor,
        });
      })
  );

  server.registerTool(
    "get_document",
    {
      description:
        "Document metadata (GET /documents/:did): title, kind, epoch, counts, and the template's style names with their " +
        "Enter/Tab flow, which are the names every write tool accepts as `style`. Example: get_document({ documentId: 'doc_...' })",
      inputSchema: { documentId },
      annotations: READ,
    },
    async ({ documentId: did }) =>
      run(async () => {
        const d = await api.getDocument(did);
        const styleName = (id: string | null) => d.template?.styles.find(s => s.id === id)?.name;
        const out = {
          id: d.id,
          projectId: d.projectId,
          title: d.title,
          kind: d.kind,
          language: d.language,
          epoch: d.epoch,
          scenes: d.sceneCount,
          pages: d.pageCount,
          words: d.wordCount,
          updated: shortTime(d.updatedAt),
          forkedFromSnapshot: d.parentSnapshotId,
          template: d.template
            ? {
                name: d.template.name,
                layout: d.template.layoutMode,
                styles: d.template.styles.map(s => ({
                  name: s.name,
                  code: s.code,
                  enter: styleName(s.enter),
                  tab: styleName(s.tab),
                })),
              }
            : undefined,
        };
        return text(compactJson(out));
      })
  );
}
