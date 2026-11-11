import {
  HOVER_CARD_STORAGE_KEY,
  loadHoverCard,
  saveHoverCard,
} from "@streets/core/settings/hover-card-setting";
import { createSignal } from "solid-js";

const read = (): boolean => {
  try {
    return loadHoverCard(localStorage.getItem(HOVER_CARD_STORAGE_KEY));
  } catch {
    return true;
  }
};

const [hoverCard, setValue] = createSignal(read());

/** 名前やアイコンに触れたとき、その人の名刺を出すか（この端末の設定）。 */
export { hoverCard };

export const setHoverCard = (on: boolean) => {
  setValue(on);
  try {
    localStorage.setItem(HOVER_CARD_STORAGE_KEY, saveHoverCard(on));
  } catch {
    // 保存できなくても、今の画面には当てる。
  }
};
