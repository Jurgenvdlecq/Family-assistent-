"use server";

import { revalidatePath } from "next/cache";
import { redirectToHome } from "@/lib/homeRedirect";
import { prisma } from "@/lib/prisma";
import { assertCurrentHousehold } from "@/lib/auth";
import { logFeedbackEvent } from "@/lib/feedback";
import { ensureMealPlan } from "@/lib/mealPlan";
import { invalidateShoppingList } from "@/lib/shoppingList";
import { recalculateVariantConfidence, maybePromoteRecipeStatus } from "@/lib/scoring";
import { DAY_ENUM, DAY_KEYS, dateForDay, getCurrentWeekStart, type DayKey } from "@/lib/week";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { answerLearningPrompt, dismissLearningPrompt } from "@/domain/learning/patterns";
import { parseFeedbackReason } from "@/domain/learning/feedbackReasons";
import { parseRecipeIngredientText } from "@/lib/recipeIngredientText";
import { parsePackageQuantity } from "@/lib/quantity/parsePackageSize";
import { PicnicClient } from "@/lib/picnic/client";
import { picnicPriceToEuros, picnicProductRef } from "@/lib/picnic/products";

const PERSONAL_STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER"] as const;
const PERSONAL_SUBJECT_TYPES = ["RECIPE_VARIANT", "RECIPE_CATEGORY", "INGREDIENT"] as const;
const RECIPE_CATEGORIES = [
  "PASTA",
  "WRAPS",
  "RICE_DISH",
  "ALL_VEGGIE_DAY",
  "QUICK_AND_EASY",
  "COMFORT_FOOD",
  "AIRFRYER",
  "OTHER",
] as const;

type ParsedLooseMealLine = ReturnType<typeof parseRecipeIngredientText>[number];

// `redirectToHome` staat in `@/lib/homeRedirect.ts` — gedeeld met
// `src/app/gerechten/actions.ts`, los gehouden omdat een `"use server"`-
// bestand alleen async functies mag exporteren.

function parsePersonalStance(value: FormDataEntryValue | null): (typeof PERSONAL_STANCES)[number] {
  const stance = String(value ?? "SOMETIMES");
  if (!PERSONAL_STANCES.includes(stance as (typeof PERSONAL_STANCES)[number])) {
    throw new Error("Onbekende voorkeur.");
  }
  return stance as (typeof PERSONAL_STANCES)[number];
}

function parsePersonalSubjectType(value: FormDataEntryValue | null): (typeof PERSONAL_SUBJECT_TYPES)[number] {
  const subjectType = String(value ?? "RECIPE_VARIANT");
  if (!PERSONAL_SUBJECT_TYPES.includes(subjectType as (typeof PERSONAL_SUBJECT_TYPES)[number])) {
    throw new Error("Onbekend voorkeurstype.");
  }
  return subjectType as (typeof PERSONAL_SUBJECT_TYPES)[number];
}

function looseMealCategory(title: string, lines: ParsedLooseMealLine[]) {
  const text = `${title} ${lines.map((line) => line.name).join(" ")}`.toLowerCase();
  if (/(airfryer|patat|friet|frikandel|kaassouffle|kaasstengel|snack)/.test(text)) return "AIRFRYER" as const;
  if (text.includes("wrap")) return "WRAPS" as const;
  if (text.includes("rijst")) return "RICE_DISH" as const;
  if (text.includes("pasta")) return "PASTA" as const;
  return "QUICK_AND_EASY" as const;
}

async function upsertLooseMealIngredients(lines: ParsedLooseMealLine[]) {
  const rows = [];
  for (const line of lines) {
    const ingredient = await prisma.ingredient.upsert({
      where: { name: line.name },
      update: {},
      create: {
        name: line.name,
        unit: line.unit,
        category: line.category,
      },
    });
    rows.push({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      quantity: line.quantity,
      unit: ingredient.unit,
    });
  }
  return rows;
}

async function savePicnicCandidatesForLooseMeal(
  householdId: string,
  rows: Awaited<ReturnType<typeof upsertLooseMealIngredients>>
) {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { picnicAuthToken: true },
  });
  if (!household.picnicAuthToken) return;

  const client = new PicnicClient(household.picnicAuthToken);
  try {
    for (const row of rows.slice(0, 12)) {
      const results = await client.search(row.ingredientName);
      const seenRefs = new Set<string>();
      const candidates = results
        .map((item) => {
          const externalRef = picnicProductRef(item);
          if (!externalRef || !item.name || seenRefs.has(externalRef)) return null;
          seenRefs.add(externalRef);
          const packageSize = item.unit_quantity ?? null;
          return {
            ingredientId: row.ingredientId,
            externalRef,
            picnicImageId: item.image_id ?? null,
            name: item.name,
            packageSize,
            packageQuantity: packageSize ? parsePackageQuantity(packageSize, row.unit) : null,
            price: picnicPriceToEuros(item.display_price ?? item.price),
            lastSeenAvailable: new Date(),
          };
        })
        .filter((item) => item !== null)
        .slice(0, 3);

      await Promise.all(
        candidates.map((candidate) =>
          prisma.product.upsert({
            where: {
              ingredientId_provider_externalRef: {
                ingredientId: candidate.ingredientId,
                provider: "PICNIC",
                externalRef: candidate.externalRef,
              },
            },
            update: candidate,
            create: candidate,
          })
        )
      );
    }
  } finally {
    const refreshedToken = client.getAuthToken();
    if (refreshedToken && refreshedToken !== household.picnicAuthToken) {
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: refreshedToken, picnicTokenUpdatedAt: new Date() },
      });
    }
  }
}

export async function setLooseMealForDay(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) throw new Error("Onbekende dag.");

  const title = String(formData.get("title") ?? "").trim();
  const lineText = String(formData.get("lineText") ?? "").trim();
  if (!title) throw new Error("Geef deze losse maaltijd een naam.");
  if (!lineText) throw new Error("Vul minimaal één productregel in.");

  const parsedLines = parseRecipeIngredientText(lineText);
  if (parsedLines.length === 0) {
    throw new Error("Ik kon geen producten herkennen. Gebruik bijvoorbeeld: patatjes, Kai: frikandel.");
  }

  const weekStart = getCurrentWeekStart();
  const mealPlan = await ensureMealPlan(householdId, weekStart);
  if (!mealPlan) throw new Error("Weekplanning kon niet worden geladen.");

  const ingredientRows = await upsertLooseMealIngredients(parsedLines);
  const recipe = await prisma.recipe.create({
    data: {
      title,
      category: looseMealCategory(title, parsedLines),
      scope: "HOUSEHOLD",
      householdId,
      originHouseholdId: householdId,
      status: "FOUND",
      source: "Losse maaltijd",
      properties: ["losse_maaltijd", "handmatig_ingevuld"],
      instructions: lineText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      ingredients: {
        create: ingredientRows.map((row) => ({
          ingredientId: row.ingredientId,
          quantity: row.quantity,
          unit: row.unit,
        })),
      },
      variants: {
        create: {
          variantType: "FAST",
          contextFit: ["losse_maaltijd", `dag_${dayKey}`],
        },
      },
    },
    include: { variants: true },
  });
  const recipeVariantId = recipe.variants[0]?.id;
  if (!recipeVariantId) throw new Error("Kon geen maaltijdvariant maken.");

  await savePicnicCandidatesForLooseMeal(householdId, ingredientRows);

  const dayEnum = DAY_ENUM[dayKey];
  const currentEntry = mealPlan.entries.find((entry) => entry.dayOfWeek === dayEnum);
  if (currentEntry) {
    await logFeedbackEvent({
      householdId,
      subjectType: "RECIPE_VARIANT",
      subjectId: currentEntry.recipeVariantId,
      eventType: "REPLACED",
      reason: "ONLY_THIS_TIME",
      explicit: true,
      context: { dayOfWeek: dayEnum, source: "loose_meal" },
    });
    await prisma.mealPlanEntry.update({
      where: { id: currentEntry.id },
      data: {
        recipeVariantId,
        source: "ASSISTANT",
        status: "ACCEPTED",
        reason: "Losse maaltijd die je hebt ingevuld.",
        score: null,
        confidenceLevel: "CERTAIN",
        replacedFromRecipeVariantId: currentEntry.recipeVariantId,
      },
    });
  } else {
    await prisma.mealPlanEntry.create({
      data: {
        mealPlanId: mealPlan.id,
        dayOfWeek: dayEnum,
        recipeVariantId,
        source: "ASSISTANT",
        status: "ACCEPTED",
        reason: "Losse maaltijd die je hebt ingevuld.",
        confidenceLevel: "CERTAIN",
      },
    });
  }

  await logFeedbackEvent({
    householdId,
    subjectType: "RECIPE_VARIANT",
    subjectId: recipeVariantId,
    eventType: "CHOSEN",
    explicit: true,
    context: { dayOfWeek: dayEnum, source: "loose_meal", lineText },
  });
  await invalidateShoppingList(mealPlan.id);

  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirectToHome("loose-meal-set", dayKey);
}

/**
 * De "eenmalige, korte" feedbackvraag bij nieuwe gerechten (sectie 7 van
 * de Blueprint). Zodra dit één keer expliciet beantwoord is, promoveert
 * het gerecht voorbij status FOUND, dus de vraag verschijnt vanzelf niet
 * opnieuw.
 */
export async function submitMealFeedback(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const recipeVariantId = String(formData.get("recipeVariantId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const positive = formData.get("positive") === "true";

  const household = await prisma.household.findUniqueOrThrow({ where: { id: householdId } });
  const rhythm = (household.weeklyRhythm ?? {}) as unknown as Partial<Record<DayKey, string>>;
  const busy = rhythm[dayKey] === "busy";

  await logFeedbackEvent({
    householdId,
    subjectType: "RECIPE_VARIANT",
    subjectId: recipeVariantId,
    eventType: "EXPLICIT_FEEDBACK",
    explicit: true,
    context: { dayOfWeek: DAY_ENUM[dayKey], busy, positive },
  });

  await recalculateVariantConfidence(householdId, recipeVariantId);
  await maybePromoteRecipeStatus(recipeVariantId, householdId);

  redirectToHome("feedback-saved");
}

export async function setPersonMealPreference(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const personId = String(formData.get("personId"));
  const subjectType = parsePersonalSubjectType(formData.get("subjectType"));
  const subjectId = String(formData.get("subjectId") ?? formData.get("recipeVariantId"));
  const dayKey = String(formData.get("dayKey")) as DayKey;
  const stance = parsePersonalStance(formData.get("stance"));

  if (!DAY_KEYS.includes(dayKey)) {
    throw new Error("Onbekende dag.");
  }

  await prisma.person.findUniqueOrThrow({
    where: { id: personId, householdId },
    select: { id: true },
  });
  if (subjectType === "RECIPE_VARIANT") {
    await prisma.recipeVariant.findUniqueOrThrow({
      where: { id: subjectId, recipe: accessibleRecipeWhere(householdId) },
      select: { id: true },
    });
  } else if (subjectType === "INGREDIENT") {
    await prisma.ingredient.findUniqueOrThrow({ where: { id: subjectId }, select: { id: true } });
  } else if (!RECIPE_CATEGORIES.includes(subjectId as (typeof RECIPE_CATEGORIES)[number])) {
    throw new Error("Onbekende categorie.");
  }

  await prisma.preference.upsert({
    where: {
      ownerType_ownerId_subjectType_subjectId: {
        ownerType: "PERSON",
        ownerId: personId,
        subjectType,
        subjectId,
      },
    },
    update: { stance, source: "EXPLICIT", confidence: 1 },
    create: {
      ownerType: "PERSON",
      ownerId: personId,
      subjectType,
      subjectId,
      stance,
      source: "EXPLICIT",
      confidence: 1,
    },
  });

  await logFeedbackEvent({
    householdId,
    personId,
    subjectType,
    subjectId,
    eventType: "EXPLICIT_FEEDBACK",
    explicit: true,
    context: { dayOfWeek: DAY_ENUM[dayKey], stance, source: "personal_week_plan" },
  });

  revalidatePath("/gerechten");
  redirectToHome("preference-saved", dayKey);
}

export async function regenerateCurrentWeekPlan(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const weekStart = getCurrentWeekStart();
  const weekEnd = dateForDay(weekStart, "sunday");

  const existingPlan = await prisma.mealPlan.findUnique({
    where: { householdId_weekStart: { householdId, weekStart } },
    select: { id: true },
  });

  if (existingPlan) {
    // Opnieuw plannen gooit de hele weekplanning weg — inclusief (via cascade)
    // de boodschappenlijst en daarmee de "ligt al in je Picnic-mandje"-
    // markeringen. Anders dan bij invalidateShoppingList valt dat hier niet te
    // bewaren: de MealPlan zelf verdwijnt. Ligt er al iets in het mandje, dan
    // dus niet stilzwijgend doorgaan maar eerlijk blokkeren — anders zou een
    // volgende overdracht alles nog een keer bestellen.
    const transferredCount = await prisma.shoppingListLine.count({
      where: { shoppingList: { mealPlanId: existingPlan.id }, transferredToPicnicAt: { not: null } },
    });
    if (transferredCount > 0) {
      redirectToHome("week-regenerate-blocked");
    }
    await prisma.shoppingList.deleteMany({ where: { mealPlanId: existingPlan.id } });
    await prisma.mealPlan.delete({ where: { id: existingPlan.id } });
  }
  await prisma.mealSuggestion.deleteMany({
    where: { householdId, targetSlot: { gte: weekStart, lte: weekEnd } },
  });

  await ensureMealPlan(householdId, weekStart, "REGENERATED");

  revalidatePath("/gerechten");
  revalidatePath("/boodschappen");
  revalidatePath("/controle");
  redirectToHome("week-regenerated");
}

export async function answerSmartLearningPrompt(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const promptId = String(formData.get("promptId"));
  const answer = parseFeedbackReason(formData.get("answer"));
  if (!answer) throw new Error("Kies een geldige reden.");

  await answerLearningPrompt({ householdId, promptId, answer });
  redirectToHome("learning-answered");
}

export async function dismissSmartLearningPrompt(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const promptId = String(formData.get("promptId"));

  await dismissLearningPrompt(householdId, promptId);
  redirectToHome("learning-dismissed");
}

/**
 * Onthoudt de huidige maaltijd van deze dag als vaste daggewoonte (WP51,
 * DATAMODEL_AUDIT.md punt 4) — een expliciete, door de gebruiker gegeven
 * instructie, geen automatische conclusie. ensureMealPlan gebruikt dit
 * daarna als voorstel voor die dag, zolang het nog veilig is.
 */
export async function setDayRoutine(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) throw new Error("Onbekende dag.");
  const recipeVariantId = String(formData.get("recipeVariantId"));

  await prisma.dayRoutine.upsert({
    where: { householdId_dayOfWeek: { householdId, dayOfWeek: DAY_ENUM[dayKey] } },
    update: { recipeVariantId },
    create: { householdId, dayOfWeek: DAY_ENUM[dayKey], recipeVariantId },
  });

  redirectToHome("routine-set");
}

/** Vergeet de vaste daggewoonte weer — deze week blijft staan, alleen toekomstige weken kiezen weer vrij. */
export async function removeDayRoutine(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) throw new Error("Onbekende dag.");

  await prisma.dayRoutine.deleteMany({ where: { householdId, dayOfWeek: DAY_ENUM[dayKey] } });

  redirectToHome("routine-removed");
}

/**
 * Zet een dag op "we eten dit niet thuis" (bv. uit eten) of zet dat weer
 * terug. De geplande maaltijd zelf blijft gewoon staan (voor geschiedenis/
 * afwisseling), maar telt niet meer mee in de boodschappenlijst
 * (aggregateMealNeeds, src/lib/shoppingList.ts) en niet als stille
 * acceptatie van het voorgestelde gerecht (entriesForSilentAcceptance,
 * src/domain/meal-planning/silentAcceptance.ts) — anders zou een dag die
 * je nooit gekookt hebt alsnog voorkeuren/geleerde patronen beïnvloeden.
 */
export async function toggleMealPlanEntrySkipped(formData: FormData) {
  const householdId = String(formData.get("householdId"));
  await assertCurrentHousehold(householdId);
  const dayKey = String(formData.get("dayKey")) as DayKey;
  if (!DAY_KEYS.includes(dayKey)) throw new Error("Onbekende dag.");
  const weekStart = new Date(String(formData.get("weekStart")));

  const mealPlan = await prisma.mealPlan.findUniqueOrThrow({
    where: { householdId_weekStart: { householdId, weekStart } },
    include: { entries: true },
  });
  const entry = mealPlan.entries.find((e) => e.dayOfWeek === DAY_ENUM[dayKey]);
  if (!entry) throw new Error("Voor deze dag staat nog geen maaltijd gepland.");

  await prisma.mealPlanEntry.update({
    where: { id: entry.id },
    data: { skipped: !entry.skipped },
  });
  await invalidateShoppingList(mealPlan.id);

  redirectToHome(entry.skipped ? "day-restored" : "day-skipped", dayKey, false);
}
