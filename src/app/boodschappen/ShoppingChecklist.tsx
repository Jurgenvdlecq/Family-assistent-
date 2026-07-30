"use client";

import { useMemo, useState, useTransition } from "react";
import { ShoppingCart } from "lucide-react";
import { toggleShoppingListLinePickedUp } from "./actions";

export type ChecklistLine = {
  id: string;
  name: string;
  detail: string | null;
  quantityLabel: string;
  pickedUp: boolean;
  imageUrl: string | null;
};

function ChecklistItemImage({ imageUrl, label }: { imageUrl: string | null; label: string }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white bg-contain bg-center bg-no-repeat text-ink-faint"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      aria-label={label}
    >
      {!imageUrl && <ShoppingCart size={14} />}
    </div>
  );
}

/**
 * Eigen afvinklijst voor zelf boodschappen doen (fysieke winkel, of gewoon
 * bijhouden wat al in het mandje ligt) — losstaand van de Picnic-flow.
 * Optimistisch lokale state: een tik moet meteen voelbaar zijn, niet pas na
 * een hele paginaherlaad zoals de andere regelacties op deze pagina doen.
 */
export default function ShoppingChecklist({ lines }: { lines: ChecklistLine[] }) {
  const [pickedUpIds, setPickedUpIds] = useState(
    () => new Set(lines.filter((line) => line.pickedUp).map((line) => line.id))
  );
  const [, startTransition] = useTransition();

  const pickedUpCount = pickedUpIds.size;
  const allDone = useMemo(() => lines.length > 0 && pickedUpCount === lines.length, [lines.length, pickedUpCount]);

  function toggle(lineId: string) {
    setPickedUpIds((prev) => {
      const next = new Set(prev);
      const nowPickedUp = !next.has(lineId);
      if (nowPickedUp) next.add(lineId);
      else next.delete(lineId);
      startTransition(() => toggleShoppingListLinePickedUp(lineId, nowPickedUp));
      return next;
    });
  }

  if (lines.length === 0) return null;

  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted">
        {allDone
          ? "Alles afgevinkt — klaar voor bij de kassa."
          : `${pickedUpCount} van ${lines.length} afgevinkt.`}
      </p>
      <div className="flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        {lines.map((line) => {
          const pickedUp = pickedUpIds.has(line.id);
          return (
            <label
              key={line.id}
              className="flex min-w-0 cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={pickedUp}
                onChange={() => toggle(line.id)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              <ChecklistItemImage imageUrl={line.imageUrl} label={line.name} />
              <div className="min-w-0 flex-1">
                <p className={`truncate ${pickedUp ? "text-ink-faint line-through" : "text-ink"}`}>{line.name}</p>
                {line.detail && <p className="truncate text-xs text-ink-faint">{line.detail}</p>}
              </div>
              <span className={`shrink-0 text-sm ${pickedUp ? "text-ink-faint" : "text-ink-muted"}`}>
                {line.quantityLabel}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
