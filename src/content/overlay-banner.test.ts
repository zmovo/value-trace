import { describe, expect, it } from "vitest";
import { clampBannerPosition, defaultBannerPosition, dockBannerPosition } from "./overlay";

describe("banner placement", () => {
  it("starts centered along the bottom edge", () => {
    expect(defaultBannerPosition(180, 44, 1280, 800)).toEqual({ left: 550, top: 740 });
  });

  it("keeps a dragged chip inside the viewport", () => {
    expect(clampBannerPosition(-40, 900, 180, 44, 1280, 800)).toEqual({ left: 16, top: 740 });
  });

  it("docks to the nearest edge when released close to it", () => {
    expect(dockBannerPosition(30, 400, 180, 44, 1280, 800)).toEqual({ left: 16, top: 400 });
    expect(dockBannerPosition(500, 20, 180, 44, 1280, 800)).toEqual({ left: 500, top: 16 });
  });

  it("leaves a chip in the middle of empty space where it was dropped", () => {
    expect(dockBannerPosition(420, 260, 180, 44, 1280, 800)).toEqual({ left: 420, top: 260 });
  });
});
