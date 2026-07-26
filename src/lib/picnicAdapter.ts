import { prisma } from "./prisma";

/**
 * Picnic-adapter — de kopieerbare-lijst-fallback (sectie 2 van het
 * ontwerpdocument). Er is geen officiële, gedocumenteerde Picnic-partner-API
 * (risico R1 uit de kritische review); voor huishoudens zonder gekoppeld
 * account blijft "kopieer de lijst en plak 'm in Picnic" altijd beschikbaar.
 * De echte mandje-koppeling zit in ./picnic/cartService.
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
