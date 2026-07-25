"use client";

import { useRef, useState, useTransition } from "react";
import { confirmTransfer } from "./actions";

export default function PicnicTransfer({
  shoppingListId,
  text,
  itemCount,
  transferred,
}: {
  shoppingListId: string;
  text: string;
  itemCount: number;
  transferred: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sommige browsers/contexten staan automatisch kopiëren niet toe —
      // selecteer de tekst dan zodat het gezin het zelf kan kopiëren.
      textareaRef.current?.select();
      setCopyFailed(true);
    }
  }

  function handleConfirm() {
    const formData = new FormData();
    formData.set("shoppingListId", shoppingListId);
    startTransition(() => confirmTransfer(formData));
  }

  return (
    <div className="mt-8 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-1 font-medium">Naar Picnic</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Kopieer de lijst en plak &lsquo;m in de Picnic-app om te bestellen.
        Definitief bestellen en een bezorgmoment kiezen doe je altijd zelf, in Picnic.
      </p>
      <textarea
        ref={textareaRef}
        readOnly
        value={text}
        rows={Math.min(itemCount, 10)}
        onFocus={(e) => e.currentTarget.select()}
        className="mb-3 w-full rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
      />
      {copyFailed && (
        <p className="mb-3 text-xs text-amber-600">
          Automatisch kopiëren lukte niet — de tekst hierboven is geselecteerd, kopieer &lsquo;m handmatig.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          {copied ? "Gekopieerd" : "Kopieer lijst"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || transferred}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {transferred ? "Overgedragen" : "Markeer als overgedragen"}
        </button>
      </div>
    </div>
  );
}
