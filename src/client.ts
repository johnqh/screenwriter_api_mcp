/**
 * @fileoverview HTTP client for the Fadewright REST API.
 * Bearer `fwk_...` key on every request, `X-Client: fadewright-mcp/<version>` on every request (this is
 * what makes the API record an edit's origin as MCP), envelope unwrapped, failures thrown as ApiError.
 * No direct fetch anywhere else in the package.
 */
import { CLIENT_HEADER, MCP_CLIENT_NAME } from "@sudobility/screenwriter_types/keys";

export interface ClientConfig {
  apiUrl: string;
  apiKey: string | undefined;
  version: string;
  maxOutputChars: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown before any request when no key is configured. */
export class NoKeyError extends Error {
  constructor() {
    super(
      "No Fadewright API key. Create one in Fadewright (Settings, API keys) and set FADEWRIGHT_API_KEY " +
        "(or apiKey in ~/.fadewright/config.json), then restart the MCP server."
    );
    this.name = "NoKeyError";
  }
}

let config: ClientConfig = {
  apiUrl: "http://localhost:8042",
  apiKey: undefined,
  version: "0.0.0",
  maxOutputChars: 60000,
};

export function configure(cfg: ClientConfig): void {
  config = { ...cfg, apiUrl: cfg.apiUrl.replace(/\/+$/, "") };
}

export function getConfig(): ClientConfig {
  return config;
}

/** `X-Client` value, e.g. `fadewright-mcp/0.1.0`. */
export const clientHeaderValue = (version: string): string => `${MCP_CLIENT_NAME}/${version}`;

/** Encode a path segment. */
export const seg = (value: string): string => encodeURIComponent(value);

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  if (!config.apiKey) throw new NoKeyError();
  const url = new URL(`${config.apiUrl}/api/v1${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        [CLIENT_HEADER]: clientHeaderValue(config.version),
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new ApiError(
      `Cannot reach the Fadewright API at ${config.apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
      0,
      "NETWORK_ERROR"
    );
  }
  const text = await res.text();
  let json: Envelope;
  try {
    json = text ? (JSON.parse(text) as Envelope) : { success: res.ok };
  } catch {
    throw new ApiError(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`, res.status, "BAD_RESPONSE");
  }
  if (!res.ok || json.success === false) {
    throw new ApiError(json.error ?? `${res.status} ${res.statusText}`, res.status, json.code ?? "UNKNOWN", json.details);
  }
  return json.data as T;
}

export const get = <T = unknown>(path: string, options?: RequestOptions) => request<T>("GET", path, options);
export const post = <T = unknown>(path: string, options?: RequestOptions) => request<T>("POST", path, options);
