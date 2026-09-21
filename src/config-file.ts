/**
 * @fileoverview Optional config file, read-only: `~/.fadewright/config.json`
 * (override with FADEWRIGHT_CONFIG_PATH). Environment variables win over the file.
 * A missing file is normal; a corrupt file is reported on stderr and treated as empty.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredConfig {
  apiUrl?: string;
  apiKey?: string;
  maxOutputChars?: number;
}

export function configFilePath(): string {
  const override = process.env["FADEWRIGHT_CONFIG_PATH"];
  if (override) return override;
  return join(homedir(), ".fadewright", "config.json");
}

export function readConfigFile(): StoredConfig {
  const path = configFilePath();
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`[fadewright-mcp] Ignoring ${path}: expected a JSON object.`);
      return {};
    }
    return parsed as StoredConfig;
  } catch (error) {
    console.error(`[fadewright-mcp] Ignoring ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export interface ResolvedConfig {
  apiUrl: string;
  apiKey: string | undefined;
  maxOutputChars: number;
}

export const DEFAULT_API_URL = "http://localhost:8042";
export const DEFAULT_MAX_OUTPUT_CHARS = 60000;

/** Resolve each value from env (empty counts as unset), then the file, then the default. */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
  stored: StoredConfig = readConfigFile()
): ResolvedConfig {
  const e = (name: string): string | undefined => {
    const v = env[name];
    return v && v.length > 0 ? v : undefined;
  };
  const maxRaw = e("FADEWRIGHT_MAX_OUTPUT_CHARS");
  const maxEnv = maxRaw ? parseInt(maxRaw, 10) : NaN;
  return {
    apiUrl: e("FADEWRIGHT_API_URL") ?? stored.apiUrl ?? DEFAULT_API_URL,
    apiKey: e("FADEWRIGHT_API_KEY") ?? stored.apiKey,
    maxOutputChars: Number.isFinite(maxEnv) && maxEnv > 0 ? maxEnv : stored.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
  };
}
