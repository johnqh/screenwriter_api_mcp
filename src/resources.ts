/**
 * @fileoverview Thin MCP resources: the outline and one scene of a document, as compact text.
 *   fadewright://documents/{id}/outline
 *   fadewright://documents/{id}/scene/{sceneId}
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "./api.ts";
import { renderOutlineLine, renderScene, truncateItems } from "./compact.ts";
import { getConfig } from "./client.ts";
import { normalizeId } from "./refs.ts";

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

export function registerResources(server: McpServer) {
  server.registerResource(
    "document-outline",
    new ResourceTemplate("fadewright://documents/{id}/outline", { list: undefined }),
    { title: "Script outline", description: "Scenes in order: number, scene id, heading, hash, element count, synopsis.", mimeType: "text/plain" },
    async (uri, { id }) => {
      const did = one(id);
      const scenes = await api.getOutlineScenes(did);
      const t = truncateItems(scenes.map(renderOutlineLine), getConfig().maxOutputChars);
      const foot = t.next !== null ? `\n-- truncated at ${t.shown} of ${t.total}; use the get_outline tool with from=${t.next} --` : "";
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: `OUTLINE ${did}: ${scenes.length} scenes\n${t.text}${foot}` }] };
    }
  );

  server.registerResource(
    "document-scene",
    new ResourceTemplate("fadewright://documents/{id}/scene/{sceneId}", { list: undefined }),
    { title: "One scene", description: "A scene's elements as compact screenplay text with element ids.", mimeType: "text/plain" },
    async (uri, { id, sceneId }) => {
      const [scene] = await api.getScenes(one(id), [normalizeId(one(sceneId))]);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: scene ? renderScene(scene) : "Scene not found" }] };
    }
  );
}
