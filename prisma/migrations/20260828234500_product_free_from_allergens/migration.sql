-- Prijslaag P1: gestructureerde allergeeninformatie van Albert Heijn.
--
-- Leeg betekent onbekend, nooit 'bevat het'.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "free_from_allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];



