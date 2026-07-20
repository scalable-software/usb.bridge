import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Glyphs } from "../dist/Glyphs.js";
import { LARGE_NUMBERS, FONT_5X7 } from "../dist/Fonts.js";
import { ClockPanel } from "../dist/ClockPanel.js";
import { OLED_WIDTH, FRAME_BYTES } from "../dist/MicroOled.js";

const plotted = (draw: (plot: (x: number, y: number) => void) => void): Set<string> => {
  const pixels = new Set<string>();
  draw((x, y) => pixels.add(`${x},${y}`));
  return pixels;
};

describe("Glyphs", () => {
  it("maps the large-number '0' from the font data (byte 1 = 0xC0 → bits 6,7)", () => {
    const pixels = plotted((plot) => Glyphs.draw(plot, LARGE_NUMBERS, "0", 0, 0));
    assert.ok(!pixels.has("0,0")); // byte 0 is 0x00
    assert.ok(pixels.has("1,6"));
    assert.ok(pixels.has("1,7"));
    assert.ok(!pixels.has("1,5"));
  });

  it("keeps every glyph inside its width x height box", () => {
    for (const character of "0123456789:") {
      const pixels = plotted((plot) => Glyphs.draw(plot, LARGE_NUMBERS, character, 0, 0));
      assert.ok(pixels.size > 0 || character === " ", `'${character}' drew nothing`);
      for (const pixel of pixels) {
        const [x, y] = pixel.split(",").map(Number);
        assert.ok(x >= 0 && x < 12 && y >= 0 && y < 48, `'${character}' leaked to ${pixel}`);
      }
    }
  });

  it("draws nothing for characters outside the font", () => {
    const pixels = plotted((plot) => Glyphs.draw(plot, LARGE_NUMBERS, "A", 0, 0));
    assert.equal(pixels.size, 0);
  });

  it("advances text by width + 1 like the reference library", () => {
    const single = plotted((plot) => Glyphs.draw(plot, FONT_5X7, "8", 0, 0));
    const shifted = plotted((plot) => Glyphs.text(plot, FONT_5X7, "88", 0, 0));
    for (const pixel of single) {
      const [x, y] = pixel.split(",").map(Number);
      assert.ok(shifted.has(`${x + 6},${y}`), `second char missing ${x + 6},${y}`);
    }
  });
});

describe("ClockPanel", () => {
  it("renders a full-size frame with the colon on even seconds only", () => {
    const withColon = ClockPanel.face(new Date(2026, 6, 19, 12, 34, 56));
    const withoutColon = ClockPanel.face(new Date(2026, 6, 19, 12, 34, 57));
    assert.equal(withColon.length, FRAME_BYTES);
    const lit = (frame: Uint8Array, fromX: number, toX: number): number => {
      let count = 0;
      for (let page = 0; page < 6; page++) {
        for (let x = fromX; x < toX; x++) {
          let byte = frame[page * OLED_WIDTH + x];
          for (; byte; byte >>= 1) count += byte & 1;
        }
      }
      return count;
    };
    assert.ok(lit(withColon, 26, 38) > 0, "colon column is empty on an even second");
    assert.equal(lit(withoutColon, 26, 38), 0, "colon shown on an odd second");
    assert.deepEqual(
      [lit(withColon, 2, 26), lit(withColon, 38, 62)],
      [lit(withoutColon, 2, 26), lit(withoutColon, 38, 62)],
      "digits changed when only the colon should",
    );
  });

  it("draws different faces for different times", () => {
    const noon = ClockPanel.face(new Date(2026, 6, 19, 12, 0, 0));
    const later = ClockPanel.face(new Date(2026, 6, 19, 21, 47, 0));
    assert.notDeepEqual(Array.from(noon), Array.from(later));
  });
});
