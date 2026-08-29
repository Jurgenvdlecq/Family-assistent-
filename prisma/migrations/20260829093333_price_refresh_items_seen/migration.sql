-- AlterTable
-- Bewust nullable en zonder default: rijen van vóór deze kolom hebben geen
-- gemeten waarde, en "0" zou daar gelezen worden als "de winkel gaf niets
-- terug" — precies de harde conclusie die deze kolom betrouwbaar moet maken.
ALTER TABLE "price_refresh_runs" ADD COLUMN "items_seen" INTEGER;
