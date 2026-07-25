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
    <div className="mt-6 min-w-0 rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-1 font-medium text-ink">Naar Picnic</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Kopieer de lijst en plak &lsquo;m in de Picnic-app om te bestellen.
        Definitief bestellen en een bezorgmoment kiezen doe je altijd zelf, in Picnic.
      </p>
      <textarea
        ref={textareaRef}
        readOnly
        value={text}
        rows={Math.min(itemCount, 10)}
        onFocus={(e) => e.currentTarget.select()}
        className="mb-3 w-full min-w-0 rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-ink-muted"
      />
      {copyFailed && (
        <p className="mb-3 text-xs text-tag-amber-ink">
          Automatisch kopiëren lukte niet — de tekst hierboven is geselecteerd, kopieer &lsquo;m handmatig.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {copied ? "Gekopieerd" : "Kopieer lijst"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || transferred}
          className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {transferred ? "Overgedragen" : "Markeer als overgedragen"}
        </button>
      </div>
    </div>
  );
}
