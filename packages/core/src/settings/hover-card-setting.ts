/**
 * 名前やアイコンに触れたとき、その人の名刺を出すか。端末ごとの設定 ——
 * 触る端末と、マウスで読む端末では要る/要らないが変わる。
 */
export const HOVER_CARD_STORAGE_KEY = "streets.v1.hoverCard";

/** 未保存・読めない値は出す。 */
export const loadHoverCard = (raw: string | null): boolean => raw !== "off";

export const saveHoverCard = (on: boolean): string => (on ? "on" : "off");
