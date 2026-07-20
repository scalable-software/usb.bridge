export const OLED_WIDTH = 64;
export const OLED_HEIGHT = 48;
const PAGES = OLED_HEIGHT / 8;
export const FRAME_BYTES = OLED_WIDTH * PAGES; // 384

// The panel's 64 visible columns sit at SSD1306 RAM columns 32-95.
const COLUMN_OFFSET = 32;
const RAM_COLUMNS = 128;
const RAM_PAGES = 8;

// SSD1306 command bytes (datasheet §9).
const CMD = {
  displayOff: 0xae,
  displayOn: 0xaf,
  clockDivide: 0xd5,
  multiplex: 0xa8,
  displayOffset: 0xd3,
  startLine: 0x40,
  chargePump: 0x8d,
  normalDisplay: 0xa6,
  invertDisplay: 0xa7,
  resumeFromRam: 0xa4,
  segmentRemap: 0xa1,
  comScanDec: 0xc8,
  comPins: 0xda,
  contrast: 0x81,
  precharge: 0xd9,
  vcomDeselect: 0xdb,
  pageAddress: 0xb0,
  highColumn: 0x10,
} as const;

// Control lines the SSD1306 needs beyond SPI. The application wires these to
// whatever the bridge offers; the driver itself knows no bridge specifics.
export interface OledPins {
  // false = command byte(s) follow, true = display data follows (D/C line).
  dataCommand(data: boolean): Promise<void>;
  // true = run, false = hold the controller in reset (RST line).
  reset(level: boolean): Promise<void>;
}

// One complete CS-framed, write-only SPI transaction; the display never
// talks back. Bridges that frame CS in hardware (MCP2210) map this to a
// plain transfer; bridges with explicit CS (SPIDriver) wrap the write in
// select/deselect.
export type OledWriter = (bytes: ArrayLike<number>) => Promise<void>;

// Device driver for the SparkFun Micro OLED (64x48, SSD1306) over SPI.
// The controller's display RAM cannot be read over SPI, so all drawing
// happens in a local frame buffer that display() pushes out page by page.
export class MicroOled {
  private write: OledWriter;
  private pins: OledPins;
  private frame = new Uint8Array(FRAME_BYTES);

  constructor(write: OledWriter, pins: OledPins) {
    this.write = write;
    this.pins = pins;
  }

  // Hardware reset, then the 64x48 module's init sequence (SparkFun
  // reference values), ending with a cleared display RAM.
  public initialize = async (): Promise<void> => {
    await this.hardwareReset();
    await this.command([
      CMD.displayOff,
      CMD.clockDivide, 0x80,
      CMD.multiplex, OLED_HEIGHT - 1,
      CMD.displayOffset, 0x00,
      CMD.startLine | 0x00,
      CMD.chargePump, 0x14, // internal charge pump (module has no external VCC)
      CMD.normalDisplay,
      CMD.resumeFromRam,
      CMD.segmentRemap | 0x01, // flip column order so (0,0) is top-left
      CMD.comScanDec,
      CMD.comPins, 0x12,
      CMD.contrast, 0x8f,
      CMD.precharge, 0xf1,
      CMD.vcomDeselect, 0x40,
      CMD.displayOn,
    ]);
    await this.clearRam();
  };

  // --- frame buffer drawing ---

  public clearFrame = (): void => {
    this.frame.fill(0);
  };

  public setPixel = (x: number, y: number, on = true): void => {
    if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) return;
    const index = (y >> 3) * OLED_WIDTH + x;
    const bit = 1 << (y & 0b111);
    this.frame[index] = on ? this.frame[index] | bit : this.frame[index] & ~bit;
  };

  // Replace the whole frame buffer (must be 384 bytes) and push it out.
  public showFrame = (frame: ArrayLike<number>): Promise<void> => {
    if (frame.length !== FRAME_BYTES) {
      throw new Error(`Frame must be ${FRAME_BYTES} bytes, got ${frame.length}`);
    }
    this.frame.set(frame);
    return this.display();
  };

  // Push the frame buffer to the controller, one 64-byte page at a time.
  public display = async (): Promise<void> => {
    for (let page = 0; page < PAGES; page++) {
      await this.setWritePosition(page, 0);
      await this.data(this.frame.subarray(page * OLED_WIDTH, (page + 1) * OLED_WIDTH));
    }
  };

  public clear = async (): Promise<void> => {
    this.clearFrame();
    await this.display();
  };

  // --- direct controller commands ---

  public invert = (inverted: boolean): Promise<void> =>
    this.command([inverted ? CMD.invertDisplay : CMD.normalDisplay]);

  public contrast = (level: number): Promise<void> =>
    this.command([CMD.contrast, level & 0xff]);

  // --- internals ---

  // RST high, drop low to reset, then release (SparkFun timing).
  private hardwareReset = async (): Promise<void> => {
    await this.pins.reset(true);
    await MicroOled.pause(5);
    await this.pins.reset(false);
    await MicroOled.pause(10);
    await this.pins.reset(true);
  };

  // Zero all 8 RAM pages across all 128 columns: the visible window is
  // smaller, but leftover data outside it would appear if the display ever
  // scrolls or the offset changes.
  private clearRam = async (): Promise<void> => {
    const blank = new Uint8Array(RAM_COLUMNS);
    for (let page = 0; page < RAM_PAGES; page++) {
      await this.command([CMD.pageAddress | page, CMD.highColumn, 0x00]);
      await this.data(blank);
    }
  };

  // Page addressing mode: select the page, then the column (offset to the
  // visible window) split into its low and high nibble commands.
  private setWritePosition = (page: number, column: number): Promise<void> => {
    const ram = column + COLUMN_OFFSET;
    return this.command([
      CMD.pageAddress | page,
      CMD.highColumn | (ram >> 4),
      ram & 0x0f,
    ]);
  };

  private command = async (bytes: ArrayLike<number>): Promise<void> => {
    await this.pins.dataCommand(false);
    await this.write(bytes);
  };

  private data = async (bytes: ArrayLike<number>): Promise<void> => {
    await this.pins.dataCommand(true);
    await this.write(bytes);
  };

  private static pause = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
}
