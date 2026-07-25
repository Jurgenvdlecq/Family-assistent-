"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { addPerson } from "./actions";

const ROLE_OPTIONS = [
  { value: "PARENT", label: "Ouder" },
  { value: "CHILD", label: "Kind" },
  { value: "OTHER", label: "Anders" },
] as const;

export default function AddPersonForm({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"PARENT" | "CHILD" | "OTHER">("CHILD");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Vul een naam in.");
      return;
    }
    const formData = new FormData();
    formData.set("householdId", householdId);
    formData.set("name", name);
    formData.set("role", role);
    startTransition(async () => {
      try {
        await addPerson(formData);
        setName("");
        setRole("CHILD");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Toevoegen mislukt.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line p-4 text-ink-faint hover:border-accent hover:text-accent"
      >
        <Plus size={20} />
        <span className="text-xs font-medium">Toevoegen</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="col-span-2 flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:col-span-1"
    >
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Naam"
        className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as typeof role)}
        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Bezig…" : "Toevoegen"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-2"
        >
          Annuleren
        </button>
      </div>
    </form>
  );
}
