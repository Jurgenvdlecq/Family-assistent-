"use client";

import { useState, useTransition } from "react";
import { addToPicnicCart } from "./actions";
import type { PicnicCartResult } from "@/lib/picnicAdapter";

export default function AddToPicnicCart({
  shoppingListId,
  connected,
}: {
  shoppingListId: string;
  connected: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PicnicCartResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await addToPicnicCart(shoppingListId);
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis.");
      }
    });
  }

  if (!connected) {
    return (
      <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 dark:bg-neutral-900">
        Nog geen Picnic-account gekoppeld. Draai eenmalig{" "}
        <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
          npm run picnic:login
        </code>{" "}
        in de terminal om deze knop te activeren.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
      >
        {isPending ? "Bezig met toevoegen…" : "Toevoegen aan Picnic-mandje"}
      </button>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800">
          <p className="font-medium text-green-700 dark:text-green-400">
            {result.added.length} product(en) toegevoegd aan je Picnic-mandje.
          </p>
          {result.notFound.length > 0 && (
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              Niet gevonden bij Picnic: {result.notFound.join(", ")} — voeg deze zelf toe.
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="mt-1 text-red-600">
              Fout bij: {result.errors.map((e) => e.ingredientName).join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
