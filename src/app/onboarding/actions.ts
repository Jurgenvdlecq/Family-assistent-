"use server";

import { prisma } from "@/lib/prisma";
import { createHouseholdSession, setHouseholdCredentials } from "@/lib/auth";
import { defaultPortionMultiplierForRole } from "@/domain/household/presence";

export type OnboardingPersonInput = {
  name: string;
  role: "PARENT" | "CHILD" | "OTHER";
  hardRestrictions: string[];
};

export type OnboardingPayload = {
  householdName: string;
  onboardingMode: "QUICK" | "DETAILED";
  planningStyle: "SAFE" | "BALANCED" | "ADVENTUROUS";
  persons: OnboardingPersonInput[];
  weeklyRhythm: Record<string, "busy" | "quiet">;
  preferredCategories: string[];
  username: string;
  password: string;
};

/**
 * Geeft `{ error }` terug in plaats van te throwen bij verwachte fouten
 * (ontbrekende velden, bezette gebruikersnaam). Next.js redact in
 * productiebuilds het bericht van een geworpen Error uit een server-actie
 * (zie node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md,
 * sectie "Handling expected errors") — de gebruiker zou dan alleen een
 * generieke "Er is iets misgegaan"-melding zien in plaats van bijvoorbeeld
 * "Deze gebruikersnaam is al in gebruik". Een teruggegeven waarde doorloopt
 * die redactie niet.
 */
export async function completeOnboarding(
  payload: OnboardingPayload
): Promise<{ householdId: string } | { error: string }> {
  const householdName = payload.householdName.trim();
  const persons = payload.persons
    .map((p) => ({ ...p, name: p.name.trim() }))
    .filter((p) => p.name.length > 0);

  if (!householdName) {
    return { error: "Gezinsnaam is verplicht." };
  }
  if (persons.length === 0) {
    return { error: "Voeg minimaal één gezinslid toe." };
  }
  if (payload.username.trim().length < 3) {
    return { error: "Kies een gebruikersnaam van minimaal 3 tekens." };
  }
  if (payload.password.length < 6) {
    return { error: "Kies een wachtwoord van minimaal 6 tekens." };
  }

  const household = await prisma.household.create({
    data: {
      name: householdName,
      weeklyRhythm: payload.weeklyRhythm,
      onboardingStatus: "COMPLETED",
      onboardingMode: payload.onboardingMode,
      planningStyle: payload.planningStyle,
      maxSmartQuestionsPerSession: 2,
      persons: {
        create: persons.map((p) => ({
          name: p.name,
          role: p.role,
          portionMultiplier: defaultPortionMultiplierForRole(p.role),
          hardRestrictions: p.hardRestrictions.filter((r) => r.trim().length > 0),
        })),
      },
    },
  });

  try {
    await setHouseholdCredentials(household.id, payload.username, payload.password);
  } catch (error) {
    // Een bezette gebruikersnaam mag geen half aangemaakt huishouden
    // achterlaten — zonder inloggegevens is het toch onbruikbaar.
    await prisma.household.delete({ where: { id: household.id } });
    return { error: error instanceof Error ? error.message : "Er ging iets mis. Probeer het opnieuw." };
  }

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

  await createHouseholdSession(household.id);
  return { householdId: household.id };
}
