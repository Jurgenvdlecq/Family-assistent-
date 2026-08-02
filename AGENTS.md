<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Family Assistant — productspecificatie

Je werkt aan deze repository:

https://github.com/Jurgenvdlecq/Family-assistent-

De oudere repository Picnic-besteller (https://github.com/Jurgenvdlecq/Picnic-besteller)
is alleen nog een functionele referentie voor bruikbare productlogica — niet
voor de architectuur.

## Hoofddoel

Een snelle, betrouwbare, professionele gezinsassistent voor weekmenuplanning,
recepten, boodschappen, vaste boodschappen, voorraadcontrole, productmatching,
Picnic-integratie, geleerde voorkeuren en controle vóór het vullen van het
winkelmandje.

De app moet: snel laden, prettig werken op mobiel, weinig handmatige stappen
vereisen, duidelijke feedback geven, betrouwbaar omgaan met hoeveelheden en
verpakkingen, veilig omgaan met Picnic-authenticatie, eenvoudig te
onderhouden zijn, professioneel ogen, en voorbereid zijn op meerdere
huishoudens.

## Belangrijke uitgangspunten

### Niet overnemen uit Picnic-besteller

GitHub als database/opslag, GitHub Issues als consumentenmelding, personal
access tokens in de browser, pincodebeveiliging in frontendcode, één groot
JavaScriptbestand, globale handmatig gemanipuleerde state, directe
DOM-manipulatie, tekstbestanden als primair datamodel, stil genegeerde
fouten, GitHub Actions als algemene applicatiebackend.

### Wel overnemen uit Picnic-besteller (productlogica, niet architectuur)

Vaste boodschappen, voorraadcontrole, extra producten, productmatching,
alternatieve producten kiezen, geleerde productvoorkeuren, twijfelgevallen
eerst controleren, expliciete bevestiging, Picnic-mandje vullen/legen,
feedback op gerechten — nooit stilzwijgend of ongecontroleerd bestellen.

## Uitvoeringsregels

- **Werk in kleine stappen**: leg uit wat je gaat veranderen, welke
  bestanden geraakt worden en wat de risico's zijn — vóór je bouwt (zie ook
  `WORKFLOW.md` voor de volledige Definition of Done).
- **Houd de app werkend**: geen grote rewrites in één keer. Verwijder oude
  code pas als de nieuwe code werkt, getest is, daadwerkelijk gebruikt wordt
  en geen regressies veroorzaakt.
- **Geen schijnfunctionaliteit**: geen knop of tekst die meer belooft dan er
  werkelijk gebeurt. Is iets nog niet af: verberg het, markeer het duidelijk
  als concept, of bouw een eerlijke fallback.
- **Kies eenvoud boven complexiteit**: elke abstractie moet een concreet
  probleem oplossen. Vermijd overengineering, onnodige libraries/
  microservices, en premature optimization.

## Definitieve productrichting

Family Assistant moet voelen als een persoonlijke gezinsassistent — niet als
een databasebeheerder, niet als een technische Picnic-tool, niet als een
lange wizard. Elke week ervaart de gebruiker vooral dit:

1. de app stelt een passende week voor;
2. de gebruiker verandert alleen wat niet klopt;
3. de boodschappen worden automatisch samengesteld;
4. alleen twijfelgevallen vragen aandacht;
5. de gebruiker bevestigt;
6. de producten worden betrouwbaar in Picnic gezet;
7. de app leert van de correcties.

## Historisch bouwplan

Het oorspronkelijke, gefaseerde bouwplan waarmee dit project begon (Fase 0
t/m 17: van eerste analyse tot volledige migratie uit Picnic-besteller) en
het bijbehorende rapportageformat staan in `PROJECT_BLUEPRINT.md`. Dat plan
is grotendeels uitgevoerd (zie `PROGRESS.md` voor de actuele status) en
stuurt niet meer actief — alleen raadplegen voor historische context, of als
een van de oorspronkelijke fases alsnog concreet relevant wordt.
