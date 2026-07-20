import type { OledFont } from "./Fonts.js";

// Where to light a pixel; drawing stays independent of any frame format.
export type Plot = (x: number, y: number) => void;

// Renders MicroView font glyphs through a plot callback. Only lit pixels are
// plotted, so the glyph background stays transparent.
export class Glyphs {
  public static draw = (plot: Plot, font: OledFont, character: string, x: number, y: number): void => {
    const index = character.charCodeAt(0) - font.startChar;
    if (index < 0 || index >= font.totalChars) return;
    const pages = Math.max(1, font.height / 8);
    for (let page = 0; page < pages; page++) {
      for (let column = 0; column < font.width; column++) {
        let slice = font.data[Glyphs.sliceIndex(font, index, page, column)];
        for (let bit = 0; slice; bit++, slice >>= 1) {
          if (slice & 1) plot(x + column, y + page * 8 + bit);
        }
      }
    }
  };

  // Characters advance by width + 1, matching the reference library.
  public static text = (plot: Plot, font: OledFont, text: string, x: number, y: number): void => {
    for (let i = 0; i < text.length; i++) {
      Glyphs.draw(plot, font, text[i], x + i * (font.width + 1), y);
    }
  };

  // Fonts one page tall store glyphs consecutively; taller fonts tile them
  // into a bitmap mapWidth pixels wide, one full-width stripe per page.
  private static sliceIndex = (font: OledFont, glyph: number, page: number, column: number): number => {
    if (font.height <= 8) return glyph * font.width + column;
    const perRow = Math.floor(font.mapWidth / font.width);
    const pages = font.height / 8;
    const start =
      Math.floor(glyph / perRow) * font.mapWidth * pages + (glyph % perRow) * font.width;
    return start + page * font.mapWidth + column;
  };
}
