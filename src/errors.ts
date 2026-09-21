/**
 * @fileoverview Error mapping: ApiError (and local errors) to messages a model can act on.
 */
import { ApiError, NoKeyError } from "./client.ts";

/** Plain-English text for writing_core ReasonCodes seen in COMMAND_INVALID. */
export const REASON_TEXT: Record<string, string> = {
  styleNotInTemplate: "that style does not exist in this document's template (see get_document for style names)",
  notFound: "an element or scene id in the command does not exist (it may have been deleted; re-read)",
  invalidPosition: "the text offset is outside the element (the text changed; re-read the element)",
  emptySelection: "the range is empty",
  notApplicable: "the command does not apply to that element",
  lockedContent: "the content is locked (locked scene or page)",
  scenesLocked: "scene numbers are locked, so scenes cannot be structurally changed",
  notContiguous: "the elements are not contiguous",
  rangeOutOfBounds: "the range is out of bounds",
  invalidParams: "the command parameters are invalid",
  exception: "the command threw an error on the server",
};

export const READ_ONLY_MESSAGE =
  "This API key is read-only (scope 'read'), so it cannot change the script. Reads and dryRun previews work. " +
  "Ask the writer to create a read_write key for this workspace (Settings, API keys) and restart the MCP server with it.";

export function formatApiError(err: ApiError, context?: { write?: boolean }): string {
  const d = err.details ?? {};
  const ids = (d["ids"] as string[] | undefined) ?? [];
  switch (err.code) {
    case "EPOCH_MISMATCH":
      return `EPOCH_MISMATCH: the script changed while you were working (its epoch is now ${String(d["epoch"] ?? "different")}). Re-read the script (get_document, then get_scene) and retry.`;
    case "CONTENT_CHANGED":
      return (
        `CONTENT_CHANGED: nothing was applied. These ids changed since you read them: ${ids.join(", ") || "(unknown)"}. ` +
        "Re-read them (get_scene or get_elements), then redo your edit against the new text."
      );
    case "COMMAND_INVALID": {
      const index = d["index"] as number | undefined;
      const reason = String(d["reason"] ?? "unknown");
      const which = index === undefined || index < 0 ? "the batch" : `command #${index}`;
      const detail = d["detail"] ? ` (${JSON.stringify(d["detail"])})` : "";
      return `COMMAND_INVALID: ${which} was refused (${reason}): ${REASON_TEXT[reason] ?? err.message}${detail}. Nothing was applied.`;
    }
    case "FORBIDDEN":
      return context?.write ? READ_ONLY_MESSAGE : `FORBIDDEN: ${err.message}`;
    case "UNAUTHORIZED":
      return "UNAUTHORIZED: the API key was rejected (invalid, revoked or expired). Create a new key in Fadewright and update FADEWRIGHT_API_KEY.";
    case "NOT_FOUND":
      return `NOT_FOUND: ${err.message}${ids.length ? ` (ids: ${ids.join(", ")})` : ""}. It may not exist, or may belong to another workspace than this key's.`;
    case "VALIDATION": {
      const issues = (d["issues"] as { path?: unknown[]; message?: string }[] | undefined) ?? [];
      const text = issues.map(i => `${(i.path ?? []).join(".")}: ${i.message}`).join("; ");
      return `VALIDATION: ${err.message}${text ? ` (${text})` : ""}`;
    }
    case "NETWORK_ERROR":
      return `NETWORK_ERROR: ${err.message}. Is screenwriter_api running and FADEWRIGHT_API_URL correct?`;
    default:
      return `Fadewright API error ${err.code} (HTTP ${err.status}): ${err.message}${err.details ? ` ${JSON.stringify(err.details)}` : ""}`;
  }
}

export function formatError(error: unknown, context?: { write?: boolean }): string {
  if (error instanceof ApiError) return formatApiError(error, context);
  if (error instanceof NoKeyError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** A local, model-actionable failure (bad ref, unknown style, ambiguous locator). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
