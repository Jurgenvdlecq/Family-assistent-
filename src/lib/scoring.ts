import { prisma } from "./prisma";

type EventContext = { busy?: boolean; positive?: boolean };

function readContext(context: unknown): EventContext {
  if (context && typeof context === "object") return context as EventContext;
  return {};
}

/**
 * Deterministische regelmotor, geen ML-model (kritische review R2 van het
 * ontwerpdocument): expliciete feedback weegt zwaarder dan afgeleid gedrag,
 * en de score stijgt/daalt geleidelijk — één slechte avond schrijft een
 * gerecht niet af (sectie 7 van de Blueprint).
 */
export async function recalculateVariantConfidence(householdId: string, recipeVariantId: string) {
  const events = await prisma.feedbackEvent.findMany({
    where: { householdId, subjectType: "RECIPE_VARIANT", subjectId: recipeVariantId },
  });

  let explicitPositive = 0;
  let explicitNegative = 0;
  let passiveChosen = 0;
  let passiveReplaced = 0;

  for (const event of events) {
    const ctx = readContext(event.context);
    if (event.eventType === "EXPLICIT_FEEDBACK") {
      if (ctx.positive) explicitPositive += 1;
      else explicitNegative += 1;
    } else if (event.eventType === "CHOSEN") {
      passiveChosen += 1;
    } else if (event.eventType === "REPLACED") {
      passiveReplaced += 1;
    }
  }

  const raw =
    0.5 +
    0.2 * explicitPositive -
    0.2 * explicitNegative +
    0.03 * passiveChosen -
    0.05 * passiveReplaced;
  const confidence = Math.min(0.98, Math.max(0.05, raw));
  const stance = confidence >= 0.75 ? "LIKED" : confidence <= 0.3 ? "RATHER_NOT" : "SOMETIMES";

  await prisma.preference.upsert({
    where: {
      ownerType_ownerId_subjectType_subjectId: {
        ownerType: "HOUSEHOLD",
        ownerId: householdId,
        subjectType: "RECIPE_VARIANT",
        subjectId: recipeVariantId,
      },
    },
    update: { stance, source: "INFERRED", confidence },
    create: {
      ownerType: "HOUSEHOLD",
      ownerId: householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: recipeVariantId,
      stance,
      source: "INFERRED",
      confidence,
    },
  });

  return { confidence, stance };
}

/**
 * "Na drie positieve ervaringen in vergelijkbare context mag een gerecht
 * een veilige keuze worden" (sectie 7). Context is hier vereenvoudigd tot
 * druk/rustig — de enige situationele variabele die het systeem echt
 * bijhoudt. Expliciete positieve feedback telt dubbel zo zwaar mee als
 * een stille, automatisch gekozen herhaling.
 */
export async function maybePromoteRecipeStatus(recipeVariantId: string, householdId: string) {
  const variant = await prisma.recipeVariant.findUniqueOrThrow({
    where: { id: recipeVariantId },
    include: { recipe: true },
  });
  if (variant.recipe.householdId !== householdId) return;
  if (variant.recipe.status === "SAFE_CHOICE") return;

  const events = await prisma.feedbackEvent.findMany({
    where: { householdId, subjectType: "RECIPE_VARIANT", subjectId: recipeVariantId },
  });

  const weightByContext = new Map<string, number>();
  let hasExplicitPositive = false;

  for (const event of events) {
    const ctx = readContext(event.context);
    const bucket = ctx.busy ? "busy" : "quiet";
    if (event.eventType === "EXPLICIT_FEEDBACK" && ctx.positive) {
      weightByContext.set(bucket, (weightByContext.get(bucket) ?? 0) + 2);
      hasExplicitPositive = true;
    } else if (event.eventType === "CHOSEN" && !event.explicit) {
      weightByContext.set(bucket, (weightByContext.get(bucket) ?? 0) + 1);
    }
  }

  const maxWeight = Math.max(0, ...weightByContext.values());

  if (maxWeight >= 3) {
    await prisma.recipe.update({ where: { id: variant.recipeId }, data: { status: "SAFE_CHOICE" } });
  } else if (hasExplicitPositive && variant.recipe.status === "FOUND") {
    await prisma.recipe.update({ where: { id: variant.recipeId }, data: { status: "PROVEN" } });
  }
}
