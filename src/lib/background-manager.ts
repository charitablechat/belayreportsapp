import bg01 from "@/assets/backgrounds/bg-01-marble-gold.png";
import bg02 from "@/assets/backgrounds/bg-02-wood-planks.png";
import bg03 from "@/assets/backgrounds/bg-03-wood-rings.png";
import bg04 from "@/assets/backgrounds/bg-04-wood-tiles.png";
import bg05 from "@/assets/backgrounds/bg-05-gold-water.png";
import bg06 from "@/assets/backgrounds/bg-06-sunset-wave.png";
import bg07 from "@/assets/backgrounds/bg-07-blue-silk.png";
import bg08 from "@/assets/backgrounds/bg-08-pool-tiles.png";
import bg09 from "@/assets/backgrounds/bg-09-topo-lines.png";
import bg10 from "@/assets/backgrounds/bg-10-marble-pink.png";

const backgrounds = [bg01, bg02, bg03, bg04, bg05, bg06, bg07, bg08, bg09, bg10];

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
