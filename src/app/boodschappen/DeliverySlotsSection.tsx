import { Truck } from "lucide-react";
import type { PicnicDeliveryPreference } from "@/generated/prisma/client";
import { getDeliveryOverviewForHousehold } from "@/lib/picnic/deliveryStatus";
import DeliverySlotsCard from "./DeliverySlotsCard";
import OrderPlacedQuestion from "./OrderPlacedQuestion";

const CARD = "mb-4 min-w-0 rounded-xl border border-line bg-surface p-3 text-xs";

/**
 * Wat er staat terwijl Picnic nog antwoordt. Hierdoor is de rest van de
 * pagina meteen bruikbaar in plaats van te wachten op een netwerkaanroep.
 */
export function DeliverySlotsPlaceholder() {
  return (
    <div className={`${CARD} text-ink-faint`}>
      <p className="flex items-center gap-2 font-medium text-ink-muted">
        <Truck size={16} />
        Bezorgen bij Picnic
      </p>
      <p className="mt-1">Bezorgmomenten ophalen…</p>
    </div>
  );
}

/**
 * Haalt de bezorgmomenten op en rendert de kaart.
 *
 * Bewust een eigen component achter een `<Suspense>`-grens: de Picnic-aanroep
 * stond eerder blokkerend vóór de rest van de pagina, waardoor élke actie op
 * deze pagina (zoals een avond aantikken) op dat netwerkverkeer moest wachten.
 * Nu rendert de pagina meteen en schuift alleen deze kaart later in.
 */
export default async function DeliverySlotsSection({
  householdId,
  picnicAuthToken,
  preference,
  shoppingListId,
  mayAskOrderPlaced,
}: {
  householdId: string;
  picnicAuthToken: string | null;
  preference: PicnicDeliveryPreference | null;
  shoppingListId: string;
  /**
   * Staan er producten van deze lijst in het mandje waarvan nog niet bevestigd
   * is dat ze besteld zijn? Alleen dán is de vraag "heb je besteld?" zinvol.
   */
  mayAskOrderPlaced: boolean;
}) {
  const overview = picnicAuthToken
    ? await getDeliveryOverviewForHousehold({ householdId, picnicAuthToken, preference })
    : null;

  // Strikt `=== 0`: bij `null` (mandje niet met zekerheid te lezen) vragen we
  // niets. Een verkeerd gelezen respons mag nooit tot deze vraag leiden.
  const cartLooksEmpty = overview?.cartItemCount === 0;

  return (
    <>
      {mayAskOrderPlaced && cartLooksEmpty && <OrderPlacedQuestion shoppingListId={shoppingListId} />}
      <DeliverySlotsCard preference={preference} overview={overview} />
    </>
  );
}
