import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Assistant",
    short_name: "Family Assistant",
    description: "Jullie persoonlijke gezinsassistent voor weekmenu, boodschappen en Picnic.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#e2622a",
    lang: "nl",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
