import { describe, expect, it } from "vite-plus/test";
import { loadHoverCard, saveHoverCard } from "./hover-card-setting";

describe("名刺を出すか", () => {
  it("保存していなければ出す", () => {
    expect(loadHoverCard(null)).toBe(true);
  });

  it("保存した値を読み戻せる", () => {
    expect(loadHoverCard(saveHoverCard(false))).toBe(false);
    expect(loadHoverCard(saveHoverCard(true))).toBe(true);
  });

  it("知らない値は出さないではなく、出すとして扱う", () => {
    expect(loadHoverCard("unknown")).toBe(true);
  });
});
