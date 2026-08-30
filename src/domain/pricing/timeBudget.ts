/**
 * Hoe de tijd van één handmatige verversing over de winkels wordt verdeeld.
 *
 * Apart van de server action zelf, zodat dit los te testen is: het is pure
 * rekenkunde, en juist bij tijdslimieten is een verkeerde aanname duur — de
 * gebruiker ziet er niets van behalve een knop die blijft draaien.
 */

/**
 * Tot wanneer déze winkel mag doorgaan.
 *
 * Het deel wordt berekend uit de tijd die er nog ís, gedeeld door het aantal
 * winkels dat nog moet — deze meegerekend. Daarmee schuift wat de vorige
 * winkel niet opmaakte gewoon door, en kan de laatste er tóch niet overheen:
 * het eindpunt ligt vast.
 *
 * Hier stond eerst een vaste helft per winkel, met als reden dat doorschuiven
 * "de laatste winkel over het totaal zou kunnen tillen". Dat klopt niet zolang
 * je vanaf een vast eindpunt rekent, en het kostte wél iets: Albert Heijn is
 * een API en is ruim binnen haar helft klaar, terwijl Dirk gescrapet wordt en
 * met pauzes tussen de pagina's structureel op het tijdslimiet strandde — met
 * Alpro en beschuit in de staart die er nooit aan toe kwamen. Die ongebruikte
 * seconden stonden gewoon stil.
 */
export function shareOfRemainingTime(
  overallDeadline: number,
  providersLeft: number,
  now: number
): number {
  if (providersLeft <= 1) return overallDeadline;
  const remaining = Math.max(0, overallDeadline - now);
  return now + Math.floor(remaining / providersLeft);
}
