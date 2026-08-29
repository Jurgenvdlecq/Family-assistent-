-- Een zelf ingetypte zoekterm per ingrediënt.
--
-- Voor de gevallen waar woordvergelijking principieel niet uitkomt: wij
-- noemen het "Snack Tomaatjes", Albert Heijn verkoopt "snoeptomaatjes". Geen
-- enkel woord gemeen, dus geen match — hoe slim de matcher ook wordt.
--
-- Nullable en zonder standaardwaarde: leeg betekent "de app zoekt het zelf
-- uit", precies zoals nu.
ALTER TABLE "ingredients" ADD COLUMN "search_term" TEXT;
