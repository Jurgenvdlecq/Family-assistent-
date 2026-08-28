import { Trash2 } from "lucide-react";
import { UNIT_LABELS } from "@/lib/categoryStyle";
import {
  addMealComponentOption,
  createMealTemplate,
  deleteMealTemplate,
  removeMealComponentOption,
} from "./mealTemplateActions";

const ROLE_LABELS: Record<string, string> = {
  BASE: "Basis (aardappel, rijst, pasta)",
  PROTEIN: "Vlees of vis",
  VEGETABLE: "Groente",
  SIDE: "Bijgerecht",
  SAUCE: "Saus",
  OTHER: "Anders",
};

const ROLES = ["BASE", "PROTEIN", "VEGETABLE", "SIDE", "SAUCE", "OTHER"] as const;

export interface MealTemplateView {
  id: string;
  name: string;
  groups: {
    id: string;
    role: string;
    name: string;
    options: { id: string; name: string; quantityPerPortion: number; unit: string; ingredientName: string }[];
  }[];
}

/**
 * Maaltijdsjablonen: "AVG" is geen gerecht maar een vorm — aardappel + vlees +
 * groente, met per onderdeel een paar opties waar de app tussen afwisselt.
 *
 * Hoeveelheden staan hier **per persoon**. Dat is bewust anders dan bij een
 * recept (dat is voor het hele gezin geschreven): een component is per
 * definitie iets wat je per eter afmeet, en zo klopt de boodschappenlijst ook
 * op een avond waarop er maar twee mensen zijn.
 */
export default function MealTemplatesEditor({
  householdId,
  templates,
  ingredientNames,
}: {
  householdId: string;
  templates: MealTemplateView[];
  ingredientNames: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-xs text-ink-muted">
        Voor avonden die geen vast gerecht zijn maar een vorm — zoals aardappel, vlees en groente. De app kiest per
        onderdeel iets anders dan de vorige keer.
      </p>

      {templates.map((template) => (
        <div key={template.id} className="min-w-0 rounded-xl border border-line bg-bg p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{template.name}</h3>
            <form action={deleteMealTemplate}>
              <input type="hidden" name="householdId" value={householdId} />
              <input type="hidden" name="mealTemplateId" value={template.id} />
              <button
                type="submit"
                aria-label={`Sjabloon ${template.name} verwijderen`}
                className="text-ink-faint hover:text-ink"
              >
                <Trash2 size={14} />
              </button>
            </form>
          </div>

          {template.groups.length === 0 && (
            <p className="mb-2 text-xs text-ink-faint">Nog geen onderdelen. Voeg er hieronder minstens één toe.</p>
          )}

          {template.groups.map((group) => (
            <div key={group.id} className="mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {ROLE_LABELS[group.role] ?? group.role}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {group.options.map((option) => (
                  <li key={option.id} className="flex items-baseline justify-between gap-2 text-sm text-ink">
                    <span>
                      {option.name}
                      <span className="ml-1.5 text-xs text-ink-faint">
                        {option.quantityPerPortion} {UNIT_LABELS[option.unit as keyof typeof UNIT_LABELS] ?? option.unit}{" "}
                        p.p. · {option.ingredientName}
                      </span>
                    </span>
                    <form action={removeMealComponentOption} className="shrink-0">
                      <input type="hidden" name="householdId" value={householdId} />
                      <input type="hidden" name="optionId" value={option.id} />
                      <button
                        type="submit"
                        aria-label={`${option.name} verwijderen`}
                        className="text-xs text-ink-faint underline decoration-dotted hover:text-ink"
                      >
                        Weg
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-xs font-medium text-ink">Onderdeel toevoegen</summary>
            <form action={addMealComponentOption} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="householdId" value={householdId} />
              <input type="hidden" name="mealTemplateId" value={template.id} />

              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Soort onderdeel
                <select
                  name="role"
                  defaultValue="PROTEIN"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Product
                <input
                  name="ingredientName"
                  list={`ingredienten-${template.id}`}
                  placeholder="Bijvoorbeeld: Schnitzel"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
                <datalist id={`ingredienten-${template.id}`}>
                  {ingredientNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>

              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
                  Per persoon
                  <input
                    name="quantityPerPortion"
                    inputMode="decimal"
                    defaultValue="1"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
                  Eenheid
                  <select
                    name="unit"
                    defaultValue="PIECE"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  >
                    <option value="PIECE">stuks</option>
                    <option value="GRAM">gram</option>
                    <option value="ML">ml</option>
                  </select>
                </label>
              </div>

              <button
                type="submit"
                className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
              >
                Toevoegen
              </button>
            </form>
          </details>
        </div>
      ))}

      <form action={createMealTemplate} className="flex items-end gap-2">
        <input type="hidden" name="householdId" value={householdId} />
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Nieuw sjabloon
          <input
            name="name"
            placeholder="Bijvoorbeeld: AVG"
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Maken
        </button>
      </form>
    </div>
  );
}
