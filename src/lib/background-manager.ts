import bg01 from "@/assets/backgrounds/bg-01-blue-wave.png";
import bg02 from "@/assets/backgrounds/bg-02-road-runner.png";
import bg03 from "@/assets/backgrounds/bg-03-marble-gold.png";
import bg04 from "@/assets/backgrounds/bg-04-wood-planks.png";
import bg05 from "@/assets/backgrounds/bg-05-wood-rings.png";
import bg06 from "@/assets/backgrounds/bg-06-wood-tiles.png";
import bg07 from "@/assets/backgrounds/bg-07-bamboo.png";
import bg09 from "@/assets/backgrounds/bg-09-gold-water.png";
import bg12 from "@/assets/backgrounds/bg-12-pool-tiles.png";
import bg17 from "@/assets/backgrounds/bg-17-treasure-map.png";

const backgrounds = [bg01, bg02, bg03, bg04, bg05, bg06, bg07, bg09, bg12, bg17];

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
