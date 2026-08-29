import type { ProductProvider } from "@/generated/prisma/enums";
import type { ProviderCapabilities } from "../types";
import { AH_CAPABILITIES } from "./ahProvider";
import { DIRK_CAPABILITIES } from "./dirkProvider";
import { picnicPriceProvider } from "./picnicProvider";

/**
 * Wat elke winkel kan, op één plek op te zoeken.
 *
 * Bestaat zodat een scherm niet hoeft te onthouden dat een Dirk-prijs uit een
 * scrape komt en een AH-prijs uit een API. Dat verschil hoort de gebruiker te
 * zien: een gelezen webpagina is brozer dan een afgesproken antwoord, en een
 * bedrag dat uit een scrape komt verdient die kanttekening.
 */
export const PROVIDER_CAPABILITIES: Record<ProductProvider, ProviderCapabilities> = {
  AH: AH_CAPABILITIES,
  DIRK: DIRK_CAPABILITIES,
  PICNIC: picnicPriceProvider.capabilities,
};

/** In gewone taal: waar komt dit bedrag vandaan? */
export function describeProviderSource(provider: ProductProvider): string | null {
  return PROVIDER_CAPABILITIES[provider].reliability === "scrape"
    ? "van de website gelezen — kan een dag achterlopen als de pagina verandert"
    : null;
}
