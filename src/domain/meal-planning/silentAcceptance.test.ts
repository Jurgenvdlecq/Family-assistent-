import { test } from "node:test";
import assert from "node:assert/strict";
import { entriesForSilentAcceptance, type SilentAcceptanceEntry } from "./silentAcceptance";

const base = {
  dayOfWeek: "MONDAY",
  recipeVariantId: "variant",
} as const;

function entry(input: Partial<SilentAcceptanceEntry> & { id: string }): SilentAcceptanceEntry {
  return {
    ...base,
    source: "AUTO",
    status: "PROPOSED",
    ...input,
  };
}

test("entriesForSilentAcceptance kiest alleen voorgestelde auto/regenerated regels", () => {
  const result = entriesForSilentAcceptance([
    entry({ id: "auto-proposed", source: "AUTO", status: "PROPOSED" }),
    entry({ id: "regen-proposed", source: "REGENERATED", status: "PROPOSED" }),
    entry({ id: "manual-proposed", source: "MANUAL", status: "PROPOSED" }),
    entry({ id: "assistant-proposed", source: "ASSISTANT", status: "PROPOSED" }),
    entry({ id: "auto-accepted", source: "AUTO", status: "ACCEPTED" }),
  ]);

  assert.deepEqual(
    result.map((item) => item.id),
    ["auto-proposed", "regen-proposed"]
  );
});

test("entriesForSilentAcceptance is idempotent voor al geaccepteerde regels", () => {
  const result = entriesForSilentAcceptance([
    entry({ id: "accepted", source: "AUTO", status: "ACCEPTED" }),
    entry({ id: "replaced", source: "AUTO", status: "REPLACED" }),
  ]);

  assert.deepEqual(result, []);
});
