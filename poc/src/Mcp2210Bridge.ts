import type { Bridge } from "./Bridge.js";
import { ReportChannel, type ReportIO } from "./ReportChannel.js";
import { WebHidTransport } from "./WebHidTransport.js";
import { Mcp2210Status } from "./Mcp2210Status.js";

const MAX_CHUNK = 60; // data bytes per 0x42 report

// Command codes (MCP2210 datasheet §3).
const COMMAND = {
  status: 0x10,
  cancelTransfer: 0x11,
  getChipSettings: 0x20,
  setChipSettings: 0x21,
  setGpioValue: 0x30,
  getGpioValue: 0x31,
  setSpiSettings: 0x40,
  getSpiSettings: 0x41,
  transfer: 0x42,
} as const;

// Command result codes (byte 1 of every response).
const RESULT = {
  ok: 0x00,
  busUnavailable: 0xf7, // an external master owns the SPI bus
  busy: 0xf8, // transfer engine cannot accept data right now
} as const;

// SPI transfer engine states (byte 3 of a 0x42 response).
const ENGINE = {
  finished: 0x10,
  started: 0x20,
  running: 0x30,
} as const;

// GP pin designation values
const PIN_GPIO = 0x00;
const PIN_CHIP_SELECT = 0x01;

export interface Mcp2210Config {
  csPin: number;
  bitRate: number;
  spiMode: number;
  // Pins to drive as general-purpose outputs, idling high (e.g. a display's
  // D/C and reset lines).
  gpioOutputs?: number[];
}

// Defaults matching the USB SPI Click wired to the EasyPIC demo firmware:
// CS on GP4, 1 MHz, mode 0.
const USB_SPI_CLICK: Mcp2210Config = { csPin: 4, bitRate: 1_000_000, spiMode: 0 };

// Bridge for the Microchip MCP2210: turns a HID report channel into an SPI
// master, hiding the chipset-specific report formats. Unlike the Excamera
// SPIDriver, the MCP2210 frames chip select in hardware around each
// transaction, so there are no explicit select/deselect commands: transfer()
// is a complete CS-framed transaction.
export class Mcp2210Bridge implements Bridge<Mcp2210Status> {
  private channel: ReportChannel;
  private product: string;
  private config: Mcp2210Config;
  private transactionBytes: number | null = null;
  private gpioValues: number | null = null;

  constructor(channel: ReportChannel, product: string, config: Mcp2210Config = USB_SPI_CLICK) {
    this.channel = channel;
    this.product = product;
    this.config = config;
  }

  public static fromDevice = (device: HIDDevice, config?: Mcp2210Config): Mcp2210Bridge =>
    new Mcp2210Bridge(new ReportChannel(new WebHidTransport(device)), device.productName, config);

  // Open the transport, then initialize the chip: designate the CS and GPIO
  // pins and apply the configured SPI settings (bridge initialization per
  // the architecture requirements — bus timing is chipset knowledge).
  public open = async (): Promise<void> => {
    await this.channel.open();
    await this.configurePins();
    await this.channel.transact((io) => this.applySettingsOn(io, 2));
  };

  public close = (): Promise<void> => this.channel.close();

  public onDisconnect = (handler: () => void): void => this.channel.onDisconnect(handler);

  // The status round-trip (echoed command code + success) proves the link.
  public verifyLink = async (): Promise<void> => {
    const reply = await this.channel.exchange([COMMAND.status]);
    Mcp2210Bridge.requireOk(reply, COMMAND.status);
  };

  public status = (): Promise<Mcp2210Status> =>
    this.channel.transact(async (io) => {
      const chipStatus = await io.command([COMMAND.status]);
      Mcp2210Bridge.requireOk(chipStatus, COMMAND.status);
      const spiSettings = await io.command([COMMAND.getSpiSettings]);
      Mcp2210Bridge.requireOk(spiSettings, COMMAND.getSpiSettings);
      const chipSettings = await io.command([COMMAND.getChipSettings]);
      Mcp2210Bridge.requireOk(chipSettings, COMMAND.getChipSettings);
      return Mcp2210Status.parse(this.product, chipStatus, spiSettings, chipSettings, this.config.csPin);
    });

  // A complete CS-framed full-duplex transaction: the chip asserts CS,
  // clocks all bytes, and releases CS after `bytes.length` bytes.
  public transfer = (bytes: ArrayLike<number>): Promise<Uint8Array> => {
    const payload = Uint8Array.from(bytes);
    if (payload.length === 0) return Promise.resolve(new Uint8Array(0));
    return this.channel.transact(async (io) => {
      if (this.transactionBytes !== payload.length) {
        await this.applySettingsOn(io, payload.length);
      }
      return this.runEngine(io, payload);
    });
  };

  // Abort a stuck transfer.
  public cancelTransfer = async (): Promise<void> => {
    const reply = await this.channel.exchange([COMMAND.cancelTransfer]);
    Mcp2210Bridge.requireOk(reply, COMMAND.cancelTransfer);
    this.transactionBytes = null;
  };

  // Drive one GPIO output (auxiliary lines such as a display's D/C and RST).
  // The chip sets all pins at once, so the current values are read once and
  // cached — this bridge is the only writer while the connection is open.
  public setGpio = (pin: number, high: boolean): Promise<void> =>
    this.channel.transact(async (io) => {
      if (this.gpioValues === null) {
        const current = await io.command([COMMAND.getGpioValue]);
        Mcp2210Bridge.requireOk(current, COMMAND.getGpioValue);
        this.gpioValues = current[4] | (current[5] << 8);
      }
      const values = high ? this.gpioValues | (1 << pin) : this.gpioValues & ~(1 << pin);
      const reply = await io.command([COMMAND.setGpioValue, 0, 0, 0, values & 0xff, values >> 8]);
      Mcp2210Bridge.requireOk(reply, COMMAND.setGpioValue);
      this.gpioValues = values;
    });

  // --- chip initialization ---

  // Read-modify-write the chip settings so only our pins change: the CS pin
  // designation plus any GPIO outputs (designated GPIO, direction output,
  // idling high). Everything else the user configured stays intact.
  private configurePins = (): Promise<void> =>
    this.channel.transact(async (io) => {
      const current = await io.command([COMMAND.getChipSettings]);
      Mcp2210Bridge.requireOk(current, COMMAND.getChipSettings);
      const settings = Array.from(current.subarray(4, 19)); // GP0-8, output, direction, other, access
      settings[this.config.csPin] = PIN_CHIP_SELECT;
      for (const pin of this.config.gpioOutputs ?? []) {
        settings[pin] = PIN_GPIO;
        settings[9 + (pin >> 3)] |= 1 << (pin & 0b111); // default output: high
        settings[11 + (pin >> 3)] &= ~(1 << (pin & 0b111)); // direction: output
      }
      if (settings.every((byte, i) => byte === current[4 + i])) return;
      const reply = await io.command([COMMAND.setChipSettings, 0, 0, 0, ...settings]);
      Mcp2210Bridge.requireOk(reply, COMMAND.setChipSettings);
    });

  // The transfer engine releases CS after `bytesPerTransaction` bytes, so
  // the setting must match each transaction's length exactly.
  private applySettingsOn = async (io: ReportIO, transactionBytes: number): Promise<void> => {
    const reply = await io.command(this.spiSettingsCommand(transactionBytes));
    Mcp2210Bridge.requireOk(reply, COMMAND.setSpiSettings);
    this.transactionBytes = transactionBytes;
  };

  private spiSettingsCommand = (transactionBytes: number): number[] => {
    const command = new Array(21).fill(0);
    command[0] = COMMAND.setSpiSettings;
    // Bit rate, 32-bit little-endian at offsets 4-7.
    command[4] = this.config.bitRate & 0xff;
    command[5] = (this.config.bitRate >> 8) & 0xff;
    command[6] = (this.config.bitRate >> 16) & 0xff;
    command[7] = (this.config.bitRate >>> 24) & 0xff;
    // CS lines idle high; only the configured CS pin drops when active.
    const idle = 0x01ff;
    const active = idle & ~(1 << this.config.csPin);
    command[8] = idle & 0xff;
    command[9] = idle >> 8;
    command[10] = active & 0xff;
    command[11] = active >> 8;
    // Offsets 12-17: all delays zero.
    command[18] = transactionBytes & 0xff;
    command[19] = transactionBytes >> 8;
    command[20] = this.config.spiMode;
    return command;
  };

  // --- transfer engine (datasheet §3.5.1) ---

  private runEngine = async (io: ReportIO, payload: Uint8Array): Promise<Uint8Array> => {
    const received: number[] = [];
    let sent = 0;
    for (let attempts = 0; attempts < 1000; attempts++) {
      const chunk = payload.subarray(sent, sent + Math.min(MAX_CHUNK, payload.length - sent));
      const reply = await io.command([COMMAND.transfer, chunk.length, 0, 0, ...chunk]);
      if (reply[1] === RESULT.busy) {
        await Mcp2210Bridge.pause(1);
        continue; // engine not ready: retry the same chunk
      }
      Mcp2210Bridge.requireOk(reply, COMMAND.transfer);
      sent += chunk.length;
      received.push(...Array.from(reply.subarray(4, 4 + reply[2])));
      if (reply[3] === ENGINE.finished) {
        return Uint8Array.from(received);
      }
    }
    throw new Error("SPI transfer engine never finished");
  };

  private static requireOk = (reply: Uint8Array, command: number): void => {
    if (reply[0] !== command) {
      throw new Error(`Response 0x${reply[0].toString(16)} does not match command 0x${command.toString(16)}`);
    }
    if (reply[1] === RESULT.busUnavailable) {
      throw new Error("SPI bus not available: an external master owns it");
    }
    if (reply[1] !== RESULT.ok) {
      throw new Error(`Command 0x${command.toString(16)} failed with code 0x${reply[1].toString(16)}`);
    }
  };

  private static pause = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
}
