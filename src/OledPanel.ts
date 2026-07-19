import { OLED_WIDTH, OLED_HEIGHT, FRAME_BYTES, type MicroOled } from "./MicroOled.js";
import type { StatusLine } from "./StatusLine.js";

// Runs one OLED task against the connected bridge; null when not connected
// or the command failed (the session reports the error).
export type OledRunner = <T>(task: (oled: MicroOled) => Promise<T>) => Promise<T | null>;

export interface OledButtons {
  init: HTMLButtonElement;
  checker: HTMLButtonElement;
  border: HTMLButtonElement;
  invert: HTMLButtonElement;
  clear: HTMLButtonElement;
}

// Demo panel for the Micro OLED wired to the SPIDriver: init plus a few
// test patterns that make successful communication visible at a glance.
export class OledPanel {
  private run: OledRunner;
  private statusLine: StatusLine;
  private inverted = false;

  constructor(buttons: OledButtons, run: OledRunner, statusLine: StatusLine) {
    this.run = run;
    this.statusLine = statusLine;
    this.wire(buttons);
  }

  public clear = (): void => {
    this.inverted = false;
  };

  private wire = (buttons: OledButtons): void => {
    buttons.init.addEventListener("click", () => this.initialize());
    buttons.checker.addEventListener("click", () => this.show(OledPanel.checkerboard(), "Checkerboard shown"));
    buttons.border.addEventListener("click", () => this.show(OledPanel.borderAndDiagonals(), "Border pattern shown"));
    buttons.invert.addEventListener("click", () => this.toggleInvert());
    buttons.clear.addEventListener("click", () => this.clearScreen());
  };

  private initialize = async (): Promise<void> => {
    const done = await this.run(async (oled) => {
      await oled.initialize();
      return true;
    });
    if (done) {
      this.inverted = false;
      this.statusLine.show("OLED reset and initialized");
    }
  };

  private show = async (frame: Uint8Array, message: string): Promise<void> => {
    const done = await this.run(async (oled) => {
      await oled.showFrame(frame);
      return true;
    });
    if (done) this.statusLine.show(message);
  };

  private toggleInvert = async (): Promise<void> => {
    const target = !this.inverted;
    const done = await this.run((oled) => oled.invert(target));
    if (done !== null) {
      this.inverted = target;
      this.statusLine.show(target ? "Display inverted" : "Display normal");
    }
  };

  private clearScreen = async (): Promise<void> => {
    const done = await this.run(async (oled) => {
      await oled.clear();
      return true;
    });
    if (done) this.statusLine.show("OLED cleared");
  };

  // 8x8-pixel checkerboard: alternate solid and empty bytes per 8-column
  // block, flipping phase on each page.
  private static checkerboard = (): Uint8Array => {
    const frame = new Uint8Array(FRAME_BYTES);
    for (let page = 0; page < OLED_HEIGHT / 8; page++) {
      for (let x = 0; x < OLED_WIDTH; x++) {
        frame[page * OLED_WIDTH + x] = ((x >> 3) + page) % 2 ? 0xff : 0x00;
      }
    }
    return frame;
  };

  // One-pixel border with both diagonals: any addressing error (offset,
  // page order, bit order) is immediately visible.
  private static borderAndDiagonals = (): Uint8Array => {
    const frame = new Uint8Array(FRAME_BYTES);
    const pixel = (x: number, y: number): void => {
      frame[(y >> 3) * OLED_WIDTH + x] |= 1 << (y & 0b111);
    };
    for (let x = 0; x < OLED_WIDTH; x++) {
      pixel(x, 0);
      pixel(x, OLED_HEIGHT - 1);
      const y = Math.round((x * (OLED_HEIGHT - 1)) / (OLED_WIDTH - 1));
      pixel(x, y);
      pixel(x, OLED_HEIGHT - 1 - y);
    }
    for (let y = 0; y < OLED_HEIGHT; y++) {
      pixel(0, y);
      pixel(OLED_WIDTH - 1, y);
    }
    return frame;
  };
}
