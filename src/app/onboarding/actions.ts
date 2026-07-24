"use server";

import { prisma } from "@/lib/prisma";

export type OnboardingPersonInput = {
  name: string;
  role: "PARENT" | "CHILD" | "OTHER";
  hardRestrictions: string[];
};

export type OnboardingPayload = {
  householdName: string;
  persons: OnboardingPersonInput[];
  weeklyRhythm: Record<string, "busy" | "quiet">;
  preferredCategories: string[];
};

export async function completeOnboarding(payload: OnboardingPayload) {
  const householdName = payload.householdName.trim();
  const persons = payload.persons
    .map((p) => ({ ...p, name: p.name.trim() }))
    .filter((p) => p.name.length > 0);

  if (!householdName) {
    throw new Error("Gezinsnaam is verplicht.");
  }
  if (persons.length === 0) {
    throw new Error("Voeg minimaal één gezinslid toe.");
  }

  const household = await prisma.household.create({
    data: {
      name: householdName,
      weeklyRhythm: payload.weeklyRhythm,
      onboardingStatus: "COMPLETED",
      persons: {
        create: persons.map((p) => ({
          name: p.name,
          role: p.role,
          hardRestrictions: p.hardRestrictions.filter((r) => r.trim().length > 0),
        })),
      },
    },
  });

  if (payload.preferredCategories.length > 0) {
    await prisma.preference.createMany({
      data: payload.preferredCategories.map((category) => ({
        ownerType: "HOUSEHOLD" as const,
        ownerId: household.id,
        subjectType: "RECIPE_CATEGORY" as const,
        subjectId: category,
        stance: "LIKED" as const,
        source: "EXPLICIT" as const,
        confidence: 1,
      })),
    });
  }

  return { householdId: household.id };
}
