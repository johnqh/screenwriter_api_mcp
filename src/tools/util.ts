/**
 * @fileoverview Shared helpers for tool handlers: result wrapping, error mapping, zod fragments.
 */
import { z } from "zod/v4";
import { formatError } from "../errors.ts";
import { getConfig } from "../client.ts";
import { compactJson } from "../compact.ts";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
export const json = (v: unknown): ToolResult => text(compactJson(v));
export const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Run a handler; turn any failure into a tool error a model can act on. */
export async function run(fn: () => Promise<ToolResult>, opts: { write?: boolean } = {}): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return fail(formatError(error, opts));
  }
}

export const maxChars = (): number => getConfig().maxOutputChars;

export const documentId = z.string().describe("Document ID (doc_..., from list_documents)");
export const sceneRef = z
  .string()
  .describe("Scene: its id (the scene heading's el_... id), a number ('42', '#12A'), an ordinal ('@3'), or heading text ('INT. DINER - NIGHT')");
export const elementId = z.string().describe("Element ID (el_...). A scene heading's element id is the scene id.");
export const expectedHash = z
  .string()
  .optional()
  .describe("Content hash from a prior read (v1:...). The edit is refused with CONTENT_CHANGED if the text changed since.");
export const expectedHashes = z
  .record(z.string(), z.string())
  .optional()
  .describe("Map of element or scene id to the content hash from a prior read (get_elements, get_outline). The whole edit is refused if any changed.");
export const dryRun = z.boolean().optional().describe("Preview: run against a scratch copy, change nothing");

export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
