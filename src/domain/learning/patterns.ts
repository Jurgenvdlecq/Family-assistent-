import type { DayOfWeek, FeedbackReason, FeedbackSubjectType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { labelFeedbackReason, MEAL_ACCEPTANCE_REASONS, MEAL_REPLACEMENT_REASONS } from "./feedbackReasons";

const PROMPT_THRESHOLD = 3;

type PatternContext = { dayOfWeek: DayOfWeek; label: string };

function readPatternContext(value: unknown): Partial<PatternContext> {
  if (value && typeof value === "object") return value as Partial<PatternContext>;
  return {};
}

export function patternConfidence(evidenceCount: number) {
  return Math.min(0.9, 0.25 + evidenceCount * 0.18);
}

export async function recordRepeatedMealReplacement(input: {
  householdId: string;
  dayOfWeek: DayOfWeek;
  replacedRecipeVariantId: string;
  replacementRecipeVariantId: string;
  replacedRecipeCategory: string;
  replacedRecipeTitle: string;
  reason: FeedbackReason;
}) {
  const contextKey = `day:${input.dayOfWeek}`;
  const existing = await prisma.learnedPattern.findFirst({
    where: {
      householdId: input.householdId,
      patternType: "MEAL_CATEGORY_REPLACED_ON_DAY",
      subjectType: "RECIPE_CATEGORY",
      subjectId: input.replacedRecipeCategory,
      contextKey,
    },
    select: { id: true, evidenceCount: true, status: true },
  });
  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const context: PatternContext = {
    dayOfWeek: input.dayOfWeek,
    label: input.replacedRecipeCategory.toLowerCase().replaceAll("_", " "),
  };

  const pattern = existing
    ? await prisma.learnedPattern.update({
        where: { id: existing.id },
        data: {
          context,
          confidence: patternConfidence(evidenceCount),
          evidenceCount,
          lastObservedAt: new Date(),
        },
      })
    : await prisma.learnedPattern.create({
        data: {
          householdId: input.householdId,
          patternType: "MEAL_CATEGORY_REPLACED_ON_DAY",
          subjectType: "RECIPE_CATEGORY" as FeedbackSubjectType,
          subjectId: input.replacedRecipeCategory,
          contextKey,
          context,
          confidence: patternConfidence(evidenceCount),
          evidenceCount,
        },
      });

  if (pattern.status !== "CANDIDATE" || evidenceCount < PROMPT_THRESHOLD) return;

  const pendingPrompt = await prisma.learningPrompt.findFirst({
    where: {
      householdId: input.householdId,
      learnedPatternId: pattern.id,
      promptType: "EXPLAIN_REPEATED_REPLACEMENT",
      status: "PENDING",
    },
    select: { id: true },
  });
  if (pendingPrompt) return;

  await prisma.learningPrompt.create({
    data: {
      householdId: input.householdId,
      learnedPatternId: pattern.id,
      promptType: "EXPLAIN_REPEATED_REPLACEMENT",
      trigger: "three_replacements",
      payload: {
        dayOfWeek: input.dayOfWeek,
        replacedRecipeCategory: input.replacedRecipeCategory,
        replacedRecipeTitle: input.replacedRecipeTitle,
        replacementRecipeVariantId: input.replacementRecipeVariantId,
        latestReason: input.reason,
        latestReasonLabel: labelFeedbackReason(input.reason),
        evidenceCount,
      },
    },
  });
}

export async function recordRepeatedMealAcceptance(input: {
  householdId: string;
  dayOfWeek: DayOfWeek;
  acceptedRecipeVariantId: string;
  acceptedRecipeCategory: string;
  acceptedRecipeTitle: string;
}) {
  const contextKey = `day:${input.dayOfWeek}`;
  const existing = await prisma.learnedPattern.findFirst({
    where: {
      householdId: input.householdId,
      patternType: "MEAL_CATEGORY_ACCEPTED_ON_DAY",
      subjectType: "RECIPE_CATEGORY",
      subjectId: input.acceptedRecipeCategory,
      contextKey,
    },
    select: { id: true, evidenceCount: true, status: true },
  });
  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const context: PatternContext = {
    dayOfWeek: input.dayOfWeek,
    label: input.acceptedRecipeCategory.toLowerCase().replaceAll("_", " "),
  };

  const pattern = existing
    ? await prisma.learnedPattern.update({
        where: { id: existing.id },
        data: {
          context,
          confidence: patternConfidence(evidenceCount),
          evidenceCount,
          lastObservedAt: new Date(),
        },
      })
    : await prisma.learnedPattern.create({
        data: {
          householdId: input.householdId,
          patternType: "MEAL_CATEGORY_ACCEPTED_ON_DAY",
          subjectType: "RECIPE_CATEGORY" as FeedbackSubjectType,
          subjectId: input.acceptedRecipeCategory,
          contextKey,
          context,
          confidence: patternConfidence(evidenceCount),
          evidenceCount,
        },
      });

  if (pattern.status !== "CANDIDATE" || evidenceCount < PROMPT_THRESHOLD) return;

  const pendingPrompt = await prisma.learningPrompt.findFirst({
    where: {
      householdId: input.householdId,
      learnedPatternId: pattern.id,
      promptType: "CONFIRM_REPEATED_ACCEPTANCE",
      status: "PENDING",
    },
    select: { id: true },
  });
  if (pendingPrompt) return;

  await prisma.learningPrompt.create({
    data: {
      householdId: input.householdId,
      learnedPatternId: pattern.id,
      promptType: "CONFIRM_REPEATED_ACCEPTANCE",
      trigger: "three_silent_acceptances",
      payload: {
        dayOfWeek: input.dayOfWeek,
        acceptedRecipeCategory: input.acceptedRecipeCategory,
        acceptedRecipeTitle: input.acceptedRecipeTitle,
        acceptedRecipeVariantId: input.acceptedRecipeVariantId,
        evidenceCount,
      },
    },
  });
}

export async function getPendingLearningPrompts(householdId: string, limit = 2) {
  const prompts = await prisma.learningPrompt.findMany({
    where: { householdId, status: "PENDING" },
    include: { learnedPattern: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return prompts.map((prompt) => {
    const context = readPatternContext(prompt.learnedPattern?.context);
    const isAcceptancePrompt = prompt.promptType === "CONFIRM_REPEATED_ACCEPTANCE";
    return {
      id: prompt.id,
      title: isAcceptancePrompt ? "Zal ik dit vaker doen?" : "Ik zie een patroon",
      question: isAcceptancePrompt
        ? `Ik merk dat ${context.label ?? "dit type gerecht"} op ${String(context.dayOfWeek ?? "deze dag").toLowerCase()} vaak blijft staan. Is dat een goede match voor die dag?`
        : prompt.promptType === "EXPLAIN_REPEATED_REPLACEMENT"
          ? `Ik merk dat ${context.label ?? "dit type gerecht"} op ${String(context.dayOfWeek ?? "deze dag").toLowerCase()} vaak wordt vervangen. Wat klopt er niet?`
          : "Wat moet ik hiervan leren?",
      answerOptions: isAcceptancePrompt ? MEAL_ACCEPTANCE_REASONS : MEAL_REPLACEMENT_REASONS.slice(1, 5),
    };
  });
}

export async function answerLearningPrompt(input: {
  householdId: string;
  promptId: string;
  answer: FeedbackReason;
}) {
  const prompt = await prisma.learningPrompt.findFirstOrThrow({
    where: { id: input.promptId, householdId: input.householdId },
    include: { learnedPattern: true },
  });

  await prisma.$transaction([
    prisma.learningPrompt.update({
      where: { id: prompt.id },
      data: {
        status: "ANSWERED",
        answeredAt: new Date(),
        payload: { ...(prompt.payload as object), answer: input.answer, answerLabel: labelFeedbackReason(input.answer) },
      },
    }),
    ...(prompt.learnedPatternId
      ? [
          prisma.learnedPattern.update({
            where: { id: prompt.learnedPatternId },
            data: {
              status: input.answer === "COINCIDENCE" || input.answer === "ONLY_THIS_TIME" ? "DISMISSED" : "CONFIRMED",
              confidence: input.answer === "COINCIDENCE" ? 0.1 : Math.max(prompt.learnedPattern?.confidence ?? 0, 0.75),
              context: {
                ...(prompt.learnedPattern?.context as object),
                confirmedReason: input.answer,
                confirmedReasonLabel: labelFeedbackReason(input.answer),
              },
            },
          }),
        ]
      : []),
  ]);
}

export async function dismissLearningPrompt(householdId: string, promptId: string) {
  const prompt = await prisma.learningPrompt.findFirstOrThrow({
    where: { id: promptId, householdId },
    select: { id: true, learnedPatternId: true },
  });
  await prisma.$transaction([
    prisma.learningPrompt.update({
      where: { id: prompt.id },
      data: { status: "DISMISSED", answeredAt: new Date() },
    }),
    ...(prompt.learnedPatternId
      ? [
          prisma.learnedPattern.update({
            where: { id: prompt.learnedPatternId },
            data: { status: "DISMISSED", confidence: 0.1 },
          }),
        ]
      : []),
  ]);
}
