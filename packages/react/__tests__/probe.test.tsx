import { describe, it, expect, vi } from "vitest";
vi.unmock("zustand");
import { create } from "zustand";

describe("probe", () => {
  it("real zustand create works", () => {
    const useS = create<{ n: number }>(() => ({ n: 1 }));
    expect(useS.getState().n).toBe(1);
  });
});
