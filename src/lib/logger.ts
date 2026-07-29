import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

// Sleutels die nooit in een logregel mogen belanden, ook niet per ongeluk via
// een generiek meta-object (Fase 16: nooit wachtwoorden, volledige tokens,
// sessiecookies of overbodige persoonsgegevens loggen).
const SENSITIVE_KEY_PATTERN =
  /token|password|wachtwoord|secret|cookie|accesscode|toegangscode/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redact(val);
    }
    return out;
  }
  return value;
}

export function createCorrelationId(): string {
  return randomUUID();
}

export interface LogEventInput {
  level: LogLevel;
  /** Korte, stabiele naam van het onderdeel, bv. "picnic_cart", "meal_plan". */
  area: string;
  message: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Eén gestructureerde logregel als JSON (Fase 16) — makkelijk terug te
 * vinden in de servergegevens op area/correlationId, zonder een aparte
 * logging-library. `meta` wordt altijd op gevoelige sleutels gefilterd, ook
 * als een aanroeper per ongeluk iets gevoeligs meegeeft.
 */
export function logEvent({ level, area, message, correlationId, meta }: LogEventInput): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    area,
    message,
    ...(correlationId ? { correlationId } : {}),
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
