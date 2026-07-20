import { OLED_WIDTH, FRAME_BYTES } from "./MicroOled.js";
import { LARGE_NUMBERS } from "./Fonts.js";
import { Glyphs } from "./Glyphs.js";
import type { OledRunner } from "./OledPanel.js";
import type { StatusLine } from "./StatusLine.js";

const TICK_MS = 1000;

// HH : MM, five 12-pixel glyphs centred in the 64-pixel width.
const GLYPH_X = [2, 14, 26, 38, 50];

// Live clock on the OLED: HH:MM in the large-number font, filling the whole
// 48-pixel height, with the colon blinking once a second. Each tick renders
// a fresh frame; a tick is skipped when the previous one is still in flight.
export class ClockPanel {
  private button: HTMLButtonElement;
  private run: OledRunner;
  private statusLine: StatusLine;
  private timer: number | null = null;
  private busy = false;

  constructor(button: HTMLButtonElement, run: OledRunner, statusLine: StatusLine) {
    this.button = button;
    this.run = run;
    this.statusLine = statusLine;
    button.addEventListener("click", () => this.toggle());
  }

  // Disconnect: stop ticking silently; the session reports the state change.
  public clear = (): void => this.stop();

  private toggle = async (): Promise<void> => {
    if (this.timer !== null) {
      this.stop();
      this.statusLine.show("Clock stopped");
      return;
    }
    await this.start();
  };

  // Initialize the display first so the clock works straight after connect.
  private start = async (): Promise<void> => {
    const ready = await this.run(async (oled) => {
      await oled.initialize();
      await oled.showFrame(ClockPanel.face(new Date()));
      return true;
    });
    if (!ready) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.button.textContent = "Stop clock";
    this.statusLine.show("Clock running");
  };

  private stop = (): void => {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.button.textContent = "Clock";
  };

  private tick = async (): Promise<void> => {
    if (this.busy) return;
    this.busy = true;
    const shown = await this.run(async (oled) => {
      await oled.showFrame(ClockPanel.face(new Date()));
      return true;
    });
    this.busy = false;
    // null: disconnected or the command failed — the session explains why.
    if (!shown && this.timer !== null) this.stop();
  };

  // The clock face for a given moment; static and pure for easy testing.
  public static face = (now: Date): Uint8Array => {
    const frame = new Uint8Array(FRAME_BYTES);
    const plot = (x: number, y: number): void => {
      frame[(y >> 3) * OLED_WIDTH + x] |= 1 << (y & 0b111);
    };
    const digits =
      String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const colon = now.getSeconds() % 2 === 0;
    const characters = [digits[0], digits[1], colon ? ":" : " ", digits[2], digits[3]];
    characters.forEach((character, i) =>
      Glyphs.draw(plot, LARGE_NUMBERS, character, GLYPH_X[i], 0),
    );
    return frame;
  };
}
