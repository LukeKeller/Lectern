import { describe, expect, it } from "vitest";
import { accentFromImageBytes, dominantAccent, hslToHex, rgbToHsl } from "./palette";

describe("rgbToHsl", () => {
  it("maps primaries to their hues", () => {
    expect(rgbToHsl(255, 0, 0)[0]).toBeCloseTo(0);
    expect(rgbToHsl(0, 255, 0)[0]).toBeCloseTo(120);
    expect(rgbToHsl(0, 0, 255)[0]).toBeCloseTo(240);
  });
  it("reports greyscale as zero saturation", () => {
    const [, s] = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
  });
});

describe("hslToHex", () => {
  it("round-trips primary hues", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
  });
  it("wraps hue past 360", () => {
    expect(hslToHex(360, 1, 0.5)).toBe(hslToHex(0, 1, 0.5));
  });
});

/** Build a flat WxH RGBA buffer filled with one colour. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

describe("dominantAccent", () => {
  it("returns null for a greyscale image (no usable colour)", () => {
    expect(dominantAccent(solid(20, 20, 180, 180, 180), 20, 20)).toBeNull();
  });

  it("picks the vivid colour and clamps it into the accent band", () => {
    // Mostly white with a block of vivid blue — blue should win over the background.
    const w = 40;
    const h = 40;
    const buf = solid(w, h, 245, 245, 245);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = (y * w + x) * 4;
        buf[i] = 30;
        buf[i + 1] = 90;
        buf[i + 2] = 220;
      }
    }
    const hex = dominantAccent(buf, w, h);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const [hue, s, l] = rgbToHsl(
      parseInt(hex!.slice(1, 3), 16),
      parseInt(hex!.slice(3, 5), 16),
      parseInt(hex!.slice(5, 7), 16),
    );
    expect(hue).toBeGreaterThan(190); // blue-ish
    expect(hue).toBeLessThan(260);
    expect(s).toBeGreaterThanOrEqual(0.39); // clamped saturation band
    expect(l).toBeGreaterThanOrEqual(0.44);
    expect(l).toBeLessThanOrEqual(0.61);
  });

  it("returns null for an empty image", () => {
    expect(dominantAccent(new Uint8Array(0), 0, 0)).toBeNull();
  });
});

describe("accentFromImageBytes", () => {
  it("returns null for unsupported / undecodable content", () => {
    expect(accentFromImageBytes(new Uint8Array([1, 2, 3]), "image/webp")).toBeNull();
    expect(accentFromImageBytes(new Uint8Array([1, 2, 3]), "image/jpeg")).toBeNull();
  });
});
