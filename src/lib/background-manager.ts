import bg01 from "@/assets/backgrounds/bg-01-blue-wave.png";
import bg02 from "@/assets/backgrounds/bg-02-road-runner.png";
import bg03 from "@/assets/backgrounds/bg-03-marble-gold.png";
import bg04 from "@/assets/backgrounds/bg-04-wood-planks.png";
import bg05 from "@/assets/backgrounds/bg-05-wood-rings.png";
import bg06 from "@/assets/backgrounds/bg-06-wood-tiles.png";
import bg08 from "@/assets/backgrounds/bg-08-pastel-paint.png";
import bg09 from "@/assets/backgrounds/bg-09-gold-water.png";
import bg10 from "@/assets/backgrounds/bg-10-sunset-wave.png";
import bg11 from "@/assets/backgrounds/bg-11-blue-silk.png";
import bg12 from "@/assets/backgrounds/bg-12-pool-tiles.png";
import bg13 from "@/assets/backgrounds/bg-13-pastel-hills.png";
import bg14 from "@/assets/backgrounds/bg-14-crystal-mosaic.png";
import bg15 from "@/assets/backgrounds/bg-15-beach-grass.png";
import bg16 from "@/assets/backgrounds/bg-16-old-map.png";
import bg17 from "@/assets/backgrounds/bg-17-treasure-map.png";

const backgrounds = [bg01, bg02, bg03, bg04, bg05, bg06, bg08, bg09, bg10, bg11, bg12, bg13, bg14, bg15, bg16, bg17];

const SESSION_KEY = "app-bg-index";

export function getSessionBackground(): string {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored !== null) {
    const index = parseInt(stored, 10);
    if (index >= 0 && index < backgrounds.length) {
      return backgrounds[index];
    }
  }

  const index = Math.floor(Math.random() * backgrounds.length);
  sessionStorage.setItem(SESSION_KEY, index.toString());
  return backgrounds[index];
}
