export type BusOwner = "none" | "USB bridge" | "external master";

export interface Mcp2210StatusFields {
  product: string;
  busOwner: BusOwner;
  busReleaseRequested: boolean;
  passwordAttempts: number;
  passwordGuessed: boolean;
  bitRate: number;
  spiMode: number;
  bytesPerTransaction: number;
  idleCs: number;
  activeCs: number;
  csPinDesignated: boolean;
}

const OWNERS: BusOwner[] = ["none", "USB bridge", "external master"];

// Telemetry snapshot of the MCP2210, combined from the chip status (0x10),
// SPI transfer settings (0x41), and chip settings (0x20) replies.
export class Mcp2210Status {
  public readonly product: string;
  public readonly busOwner: BusOwner;
  public readonly busReleaseRequested: boolean;
  public readonly passwordAttempts: number;
  public readonly passwordGuessed: boolean;
  public readonly bitRate: number;
  public readonly spiMode: number;
  public readonly bytesPerTransaction: number;
  public readonly idleCs: number;
  public readonly activeCs: number;
  public readonly csPinDesignated: boolean;

  constructor(fields: Mcp2210StatusFields) {
    this.product = fields.product;
    this.busOwner = fields.busOwner;
    this.busReleaseRequested = fields.busReleaseRequested;
    this.passwordAttempts = fields.passwordAttempts;
    this.passwordGuessed = fields.passwordGuessed;
    this.bitRate = fields.bitRate;
    this.spiMode = fields.spiMode;
    this.bytesPerTransaction = fields.bytesPerTransaction;
    this.idleCs = fields.idleCs;
    this.activeCs = fields.activeCs;
    this.csPinDesignated = fields.csPinDesignated;
  }

  public static parse = (
    product: string,
    chipStatus: Uint8Array,
    spiSettings: Uint8Array,
    chipSettings: Uint8Array,
    csPin: number,
  ): Mcp2210Status =>
    new Mcp2210Status({
      product,
      busOwner: OWNERS[chipStatus[3]] ?? "none",
      busReleaseRequested: chipStatus[2] === 0x00,
      passwordAttempts: chipStatus[4],
      passwordGuessed: chipStatus[5] === 0x01,
      // Bit rate is a 32-bit little-endian value at offsets 4-7.
      bitRate: spiSettings[4] | (spiSettings[5] << 8) | (spiSettings[6] << 16) | (spiSettings[7] << 24),
      spiMode: spiSettings[20],
      bytesPerTransaction: spiSettings[18] | (spiSettings[19] << 8),
      idleCs: spiSettings[8] | (spiSettings[9] << 8),
      activeCs: spiSettings[10] | (spiSettings[11] << 8),
      // GP pin designations sit at offsets 4-12; 0x01 marks a chip-select pin.
      csPinDesignated: chipSettings[4 + csPin] === 0x01,
    });
}
