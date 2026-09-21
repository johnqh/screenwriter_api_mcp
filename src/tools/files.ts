/**
 * @fileoverview Import/export tools: export_document, import_file.
 * The API is synchronous and supports Fountain, FDX and JSON export; Fountain, FDX and Fade In import.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { seg } from "../client.ts";
import * as api from "../api.ts";
import { READ, WRITE, documentId, json, maxChars, run, text } from "./util.ts";
import { READ_ONLY_MESSAGE, ToolError } from "../errors.ts";

interface ExportResult {
  filename: string;
  mimeType: string;
  contentB64: string;
  format: string;
  report: { summary: { info: number; warn: number; loss: number; error: number }; diagnostics: { severity: string; message: string; count: number }[] };
}

const TEXT_FORMATS = new Set(["fountain", "fdx", "json"]);

export function registerFileTools(server: McpServer) {
  server.registerTool(
    "export_document",
    {
      description:
        "Export the live script as text (POST /documents/:did/export). Formats the API supports: 'fountain' (default), 'fdx' " +
        "(Final Draft XML), 'json' (backup). All are returned as text; long output is paged with `offset`. PDF, DOCX and other " +
        "binary formats are not available from the API yet. Example: export_document({ documentId: 'doc_...', format: 'fountain' })",
      inputSchema: {
        documentId,
        format: z.string().optional().describe("fountain | fdx | json (default fountain)"),
        offset: z.number().int().min(0).optional().describe("Character offset to continue from a truncated export"),
      },
      annotations: READ,
    },
    async ({ documentId: did, format, offset }) =>
      run(async () => {
        const fmt = (format ?? "fountain").toLowerCase();
        const r = await client.post<ExportResult>(`/documents/${seg(did)}/export`, { body: { format: fmt } });
        if (!TEXT_FORMATS.has(r.format)) {
          return text(`Exported ${r.filename} (${r.mimeType}, ${Math.round((r.contentB64.length * 3) / 4)} bytes, base64 not shown). Binary formats cannot be returned inline.`);
        }
        const full = Buffer.from(r.contentB64, "base64").toString("utf8");
        const start = offset ?? 0;
        const cap = maxChars();
        const chunk = full.slice(start, start + cap);
        const more = start + cap < full.length;
        const loss = r.report.summary.loss + r.report.summary.error;
        const head = `EXPORT ${r.filename} (${r.format}, ${full.length} chars${loss ? `, ${loss} conversion loss/error notes` : ""})${start ? ` from offset ${start}` : ""}`;
        const foot = more ? `\n-- truncated at ${start + cap} of ${full.length}. Continue with export_document {"documentId":"${did}","format":"${r.format}","offset":${start + cap}} --` : "";
        return text(`${head}\n${chunk}${foot}`);
      })
  );

  server.registerTool(
    "import_file",
    {
      description:
        "Import a Fountain, FDX or Fade In script into a project as a NEW document (POST /projects/:pid/documents/import; the " +
        "format is detected from the content). Pass either a local `path` or the text as `content` with a `filename`. Returns the new " +
        "document id and a conversion report. Needs read_write. " +
        "Example: import_file({ projectId: 'prj_...', filename: 'pilot.fountain', content: 'INT. LAB - DAY\\n\\nHum.' })",
      inputSchema: {
        projectId: z.string().describe("Project ID (prj_...)"),
        path: z.string().optional().describe("Local file path (read by this server)"),
        filename: z.string().optional().describe("File name with extension (a hint), required with `content`"),
        content: z.string().optional().describe("The script text (Fountain or FDX XML)"),
        title: z.string().optional(),
      },
      annotations: WRITE,
    },
    async ({ projectId, path, filename, content, title }) =>
      run(async () => {
        if ((await api.getScope()) === "read") throw new ToolError(READ_ONLY_MESSAGE);
        let bytes: Buffer;
        let name = filename;
        if (path) {
          if (!existsSync(path)) throw new ToolError(`FILE_NOT_FOUND: ${path}`);
          bytes = readFileSync(path);
          name = name ?? basename(path);
        } else if (content !== undefined) {
          if (!name) throw new ToolError("Give `filename` (e.g. 'script.fountain') with `content`.");
          bytes = Buffer.from(content, "utf8");
        } else {
          throw new ToolError("Give `path` or `content`.");
        }
        const r = await client.post<{
          document: api.DocumentMetaView;
          format: string;
          report: { summary: { info: number; warn: number; loss: number; error: number }; stats: { elements: number; scenes: number } };
        }>(`/projects/${seg(projectId)}/documents/import`, {
          body: { filename: name, contentB64: bytes.toString("base64"), ...(title ? { title } : {}) },
        });
        return json({
          documentId: r.document.id,
          title: r.document.title,
          format: r.format,
          scenes: r.report.stats.scenes,
          elements: r.report.stats.elements,
          notes: r.report.summary,
        });
      }, { write: true })
  );
}
