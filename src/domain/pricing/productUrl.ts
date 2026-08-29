/**
 * Welke opgeslagen productlink mag er als `href` op het scherm?
 *
 * De links komen van buiten: bij Dirk uit gescrapete HTML, en bij elke winkel
 * die er later bij komt uit hún antwoord. De providers letten daar zelf al op,
 * maar dit is de laatste horde vóór het scherm — en die hoort er te zijn,
 * want een rij in `products` kan ook uit een oudere versie of een handmatige
 * ingreep komen. Alleen `http`/`https` komt erdoor; een `javascript:`- of
 * `data:`-adres is geen productpagina en heeft in een `href` niets te zoeken.
 *
 * `null` betekent hier hetzelfde als overal in deze laag: we weten het niet,
 * dus zeggen we niets — in plaats van een link die iets anders doet dan er
 * staat.
 */
export function displayableProductUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    // Geen geldig adres — dan is er ook niets te openen.
    return null;
  }
}
