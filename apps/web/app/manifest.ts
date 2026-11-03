import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anar",
    short_name: "Anar",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5f4",
    theme_color: "#7a1438",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
