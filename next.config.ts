import type { NextConfig } from "next";

// devIndicators uit: de nieuwe on-screen ontwikkelindicator van Next.js 16
// bleek in sommige omgevingen de volledige React-hydratatie van de app te
// blokkeren (de pagina rendert, maar geen enkele knop reageert nog) zodra de
// achterliggende verbinding van die indicator niet tot stand komt. Puur een
// debug-UI-onderdeel — uitzetten heeft geen functioneel effect, Next.js
// blijft build-/runtime-fouten gewoon tonen.
const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
