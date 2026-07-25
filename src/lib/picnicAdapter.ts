import { prisma } from "./prisma";

/**
 * Picnic-adapter — vervangbare interface (sectie 2 van het ontwerpdocument).
 * Er is geen bevestigde publieke Picnic-partner-API (risico R1 uit de
 * kritische review), dus v1 gebruikt de eenvoudigste, meest robuuste
 * overdrachtsvorm: een kopieerbare lijst die het gezin zelf in de
 * officiële Picnic-app plakt. De rest van de app kent alleen deze
 * functie — hoe de overdracht precies gebeurt kan later vervangen worden
 * (bijv. een diepere integratie) zonder dat er iets anders hoeft te
 * veranderen.
 */
export async function preparePicnicTransfer(shoppingListId: string) {
  const shoppingList = await prisma.shoppingList.findUniqueOrThrow({
    where: { id: shoppingListId },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  const lines = [...shoppingList.lines].sort((a, b) =>
    a.ingredient.name.localeCompare(b.ingredient.name)
  );

  const text = lines
    .map((line) => {
      const label = line.product?.name ?? line.ingredient.name;
      const detail = line.product?.packageSize ? ` (${line.product.packageSize})` : "";
      return `- ${label}${detail}`;
    })
    .join("\n");

  return { text, itemCount: lines.length, status: shoppingList.status };
}

export async function markTransferred(shoppingListId: string) {
  await prisma.shoppingList.update({
    where: { id: shoppingListId },
    data: { status: "TRANSFERRED" },
  });
}
