#!/usr/bin/env bun
/**
 * ViaInk MCP server (stdio). Lets a writer's own AI assistant read and edit their ViaInk scripts
 * over the REST API with a personal API key.
 *
 * Config (env wins over the optional file ~/.fadewright/config.json):
 *   FADEWRIGHT_API_KEY          personal API key (fwk_...), scoped to one workspace, read or read_write
 *   FADEWRIGHT_API_URL          API base URL (default http://localhost:8036)
 *   FADEWRIGHT_MAX_OUTPUT_CHARS ceiling per tool result (default 60000)
 *   FADEWRIGHT_CONFIG_PATH      config file override
 *
 * stdout is the MCP protocol: diagnostics go to stderr only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with { type: "json" };
import { configure } from "./client.ts";
import { resolveConfig } from "./config-file.ts";
import { registerResources } from "./resources.ts";
import { registerDiscoveryTools } from "./tools/discovery.ts";
import { registerReadTools } from "./tools/read.ts";
import { registerWriteTools } from "./tools/write.ts";
import { registerSnapshotTools } from "./tools/snapshots.ts";
import { registerFileTools } from "./tools/files.ts";

const cfg = resolveConfig();
configure({ ...cfg, version: pkg.version });

if (!cfg.apiKey) {
  console.error(
    "[fadewright-mcp] No API key configured. Set FADEWRIGHT_API_KEY (or apiKey in ~/.fadewright/config.json). " +
      "Every tool will return a clear error until then."
  );
}

const server = new McpServer({ name: "fadewright-api", version: pkg.version });

registerDiscoveryTools(server);
registerReadTools(server);
registerWriteTools(server);
registerSnapshotTools(server);
registerFileTools(server);
registerResources(server);

await server.connect(new StdioServerTransport());
