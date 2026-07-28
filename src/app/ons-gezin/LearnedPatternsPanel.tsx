import { Sparkles, Trash2 } from "lucide-react";
import { CATEGORY_LABELS } from "@/lib/categoryStyle";
import { prisma } from "@/lib/prisma";
import { dismissLearnedPattern } from "./learnedPatternActions";

const DAY_LABELS: Record<string, string> = {
  MONDAY: "maandag",
  TUESDAY: "dinsdag",
  WEDNESDAY: "woensdag",
  THURSDAY: "donderdag",
  FRIDAY: "vrijdag",
  SATURDAY: "zaterdag",
  SUNDAY: "zondag",
};

const STATUS_LABELS: Record<string, string> = {
  CANDIDATE: "Nog aan het leren",
  CONFIRMED: "Bevestigd",
};

function readContext(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function labelCategory(category: string | null) {
  if (!category) return "dit type gerecht";
  return CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category.toLowerCase().replaceAll("_", " ");
}

function labelPattern(pattern: {
  patternType: string;
  subjectId: string | null;
  context: unknown;
}) {
  const context = readContext(pattern.context);
  const dayLabel = DAY_LABELS[String(context.dayOfWeek ?? "")] ?? "deze dag";
  const categoryLabel = labelCategory(pattern.subjectId);

  if (pattern.patternType === "MEAL_CATEGORY_ACCEPTED_ON_DAY") {
    return `${categoryLabel} blijft vaak staan op ${dayLabel}`;
  }
  if (pattern.patternType === "MEAL_CATEGORY_REPLACED_ON_DAY") {
    return `${categoryLabel} wordt vaak vervangen op ${dayLabel}`;
  }
  return `Patroon rond ${categoryLabel}`;
}

function labelPatternReason(contextValue: unknown) {
  const context = readContext(contextValue);
  const label = context.confirmedReasonLabel ?? context.answerLabel;
  return typeof label === "string" && label ? label : null;
}

export default async function LearnedPatternsPanel({ householdId }: { householdId: string }) {
  const patterns = await prisma.learnedPattern.findMany({
    where: {
      householdId,
      status: { in: ["CANDIDATE", "CONFIRMED"] },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 8,
  });

  return (
    <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
        <Sparkles size={16} className="text-tag-purple-ink" />
        Wat ik over jullie week heb geleerd
      </summary>
      <div className="mt-4 grid gap-2">
        {patterns.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            Nog geen weekpatronen om te beheren. Dit groeit vanzelf wanneer jullie weekmenu&apos;s bevestigen of aanpassen.
          </p>
        ) : (
          patterns.map((pattern) => {
            const reason = labelPatternReason(pattern.context);
            return (
              <div key={pattern.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{labelPattern(pattern)}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {STATUS_LABELS[pattern.status] ?? pattern.status}
                    {` · ${pattern.evidenceCount} signalen · ${Math.round(pattern.confidence * 100)}% zekerheid`}
                    {reason ? ` · ${reason}` : ""}
                  </p>
                </div>
                <form action={dismissLearnedPattern} className="shrink-0">
                  <input type="hidden" name="householdId" value={householdId} />
                  <input type="hidden" name="patternId" value={pattern.id} />
                  <button
                    type="submit"
                    aria-label="Patroon vergeten"
                    title="Patroon vergeten"
                    className="rounded-lg border border-line p-2 text-ink-faint transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={14} />
                  </button>
                </form>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}
