"use client";

import { useState, useTransition } from "react";
import { updatePlanningStyle } from "./actions";

type PlanningStyle = "SAFE" | "BALANCED" | "ADVENTUROUS";

// Zelfde labels/omschrijvingen als de onboarding-wizard (OnboardingWizard.tsx)
// — dit is dezelfde keuze, nu ook na onboarding aan te passen.
const PLANNING_STYLES: { value: PlanningStyle; label: string; description: string }[] = [
  { value: "SAFE", label: "Veilig", description: "Meer bekende en bewezen gerechten." },
  { value: "BALANCED", label: "Gebalanceerd", description: "Bekend genoeg, met af en toe iets nieuws." },
  { value: "ADVENTUROUS", label: "Nieuwsgierig", description: "Meer ruimte voor proberen en variatie." },
];

export default function PlanningStyleEditor({
  householdId,
  initialPlanningStyle,
}: {
  householdId: string;
  initialPlanningStyle: PlanningStyle;
}) {
  const [planningStyle, setPlanningStyle] = useState(initialPlanningStyle);
  const [isPending, startTransition] = useTransition();

  function choose(value: PlanningStyle) {
    setPlanningStyle(value);
    const formData = new FormData();
    formData.set("householdId", householdId);
    formData.set("planningStyle", value);
    startTransition(() => updatePlanningStyle(formData));
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {PLANNING_STYLES.map((style) => {
        const selected = planningStyle === style.value;
        return (
          <button
            key={style.value}
            type="button"
            disabled={isPending}
            onClick={() => choose(style.value)}
            className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
              selected ? "border-accent/50 bg-accent-soft" : "border-line bg-surface hover:border-accent/60"
            }`}
          >
            <p className="text-sm font-medium text-ink">{style.label}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{style.description}</p>
          </button>
        );
      })}
    </div>
  );
}
