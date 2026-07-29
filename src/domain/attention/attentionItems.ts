export type AttentionItemType =
  | "WEEK_MENU_READY_NO_GROCERIES"
  | "PRODUCT_REVIEW_OPEN"
  | "GROCERIES_READY_NOT_SENT_TO_PICNIC"
  | "PICNIC_CART_FILLED_NOT_CONFIRMED";

export type AttentionItem = {
  type: AttentionItemType;
  title: string;
  body: string;
  href: string;
  cta: string;
  // v1 (WP69): elke situatie is "normal" — er bestaat nog geen betrouwbare
  // bron voor iets dat écht urgenter is (bijv. een naderende bezorgtijd).
  urgency: "normal";
  // Sinds wanneer deze situatie waar is — geen wacht-/stiltedrempel hier:
  // dat is beleid van de pushlaag (later WP), niet van deze laag zelf. De
  // homepage toont een item altijd meteen; push mag zelf op relevantSince
  // filteren voordat hij daadwerkelijk stuurt.
  relevantSince: Date;
  dedupeKey: string;
};

export type AttentionInput = {
  mealPlanCreatedAt: Date;
  hasShoppingList: boolean;
  reviewCount: number;
  reviewFlaggedAt: Date | null;
  shoppingListStatus: "PREPARED" | "REVIEWED" | "TRANSFERRED" | null;
  reviewedAt: Date | null;
  hasTransferredLines: boolean;
  lastTransferredAt: Date | null;
  orderConfirmedAt: Date | null;
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Eén centrale bron van waarheid voor "wat staat er nog open" (WP69) —
 * zowel de homepage-tegel als de latere pushscheduler lezen hieruit, zodat
 * push nooit eigen businesslogica dupliceert. Volgorde in de returnwaarde
 * is de prioriteitsvolgorde: dichter bij een echte Picnic-bestelling weegt
 * zwaarder dan een vroege planningsstap, want deze vier situaties komen in
 * de praktijk zelden tegelijk voor (elke stap heeft de vorige nodig), dus
 * de volgorde doet er vooral toe in de zeldzame gedeeltelijke-afronding-
 * gevallen (bijv. een deel van het mandje al gevuld, een deel nog te
 * controleren).
 */
export function getAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.hasTransferredLines && !input.orderConfirmedAt && input.lastTransferredAt) {
    items.push({
      type: "PICNIC_CART_FILLED_NOT_CONFIRMED",
      title: "Rond je bestelling af in Picnic",
      body: "De producten staan in je Picnic-mandje. Open Picnic om de bestelling af te ronden.",
      href: "/boodschappen",
      cta: "Naar boodschappen",
      urgency: "normal",
      relevantSince: input.lastTransferredAt,
      dedupeKey: `PICNIC_CART_FILLED_NOT_CONFIRMED:${dateKey(input.lastTransferredAt)}`,
    });
  }

  if (input.shoppingListStatus === "REVIEWED" && !input.hasTransferredLines && input.reviewedAt) {
    items.push({
      type: "GROCERIES_READY_NOT_SENT_TO_PICNIC",
      title: "Klaar om naar Picnic te gaan",
      body: "De lijst is gecontroleerd. Je bevestigt zelf nog voordat er iets naar Picnic gaat.",
      href: "/boodschappen",
      cta: "Naar bevestigen",
      urgency: "normal",
      relevantSince: input.reviewedAt,
      dedupeKey: `GROCERIES_READY_NOT_SENT_TO_PICNIC:${dateKey(input.reviewedAt)}`,
    });
  }

  if (input.reviewCount > 0 && input.reviewFlaggedAt) {
    items.push({
      type: "PRODUCT_REVIEW_OPEN",
      title: `${input.reviewCount} productkeuze${input.reviewCount === 1 ? "" : "s"} controleren`,
      body: "Er zijn nog producten, verpakkingen of hoeveelheden die ik niet stil wil aannemen.",
      href: "/controle",
      cta: "Controleren",
      urgency: "normal",
      relevantSince: input.reviewFlaggedAt,
      dedupeKey: `PRODUCT_REVIEW_OPEN:${dateKey(input.reviewFlaggedAt)}`,
    });
  }

  if (!input.hasShoppingList) {
    items.push({
      type: "WEEK_MENU_READY_NO_GROCERIES",
      title: "Weekmenu staat klaar",
      body: "Als dit ongeveer klopt, maak ik hierna de boodschappenlijst met vaste boodschappen en voorraadcontrole.",
      href: "/boodschappen",
      cta: "Boodschappen voorbereiden",
      urgency: "normal",
      relevantSince: input.mealPlanCreatedAt,
      dedupeKey: `WEEK_MENU_READY_NO_GROCERIES:${dateKey(input.mealPlanCreatedAt)}`,
    });
  }

  return items;
}
