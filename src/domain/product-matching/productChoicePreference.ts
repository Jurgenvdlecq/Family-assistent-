import { prisma } from "@/lib/prisma";

export const PRODUCT_CHOICE_PREFERENCES = ["BALANCED", "LOW_PRICE", "KNOWN_PACKAGE"] as const;

export type ProductChoicePreference = (typeof PRODUCT_CHOICE_PREFERENCES)[number];

export const PRODUCT_CHOICE_LABELS: Record<ProductChoicePreference, string> = {
  BALANCED: "Gebalanceerd",
  LOW_PRICE: "Voordelig",
  KNOWN_PACKAGE: "Bekende verpakking",
};

export function normalizeProductChoicePreference(value: unknown): ProductChoicePreference {
  return PRODUCT_CHOICE_PREFERENCES.includes(value as ProductChoicePreference)
    ? (value as ProductChoicePreference)
    : "BALANCED";
}

export function productChoicePreferenceFromDeliveryPreference(deliveryPreference: unknown): ProductChoicePreference {
  if (typeof deliveryPreference !== "object" || deliveryPreference === null) return "BALANCED";
  const raw = (deliveryPreference as { productChoicePreference?: unknown }).productChoicePreference;
  return normalizeProductChoicePreference(raw);
}

export async function getHouseholdProductChoicePreference(householdId: string) {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { deliveryPreference: true },
  });
  return productChoicePreferenceFromDeliveryPreference(household.deliveryPreference);
}
