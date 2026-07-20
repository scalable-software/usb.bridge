const CLOCK_HZ = 12_000_000;
const DIVIDER_OFFSET = 3;

export interface Mcp2221StatusFields {
  product: string;
  speedKhz: number;
  scl: boolean;
  sda: boolean;
  requestedBytes: number;
  transferredBytes: number;
  readPending: number;
  hardwareRevision: string;
  firmwareRevision: string;
}

// Telemetry snapshot of the MCP2221, parsed from the Status/Set Parameters
// (0x10) response.
export class Mcp2221Status {
  public readonly product: string;
  public readonly speedKhz: number;
  public readonly scl: boolean;
  public readonly sda: boolean;
  public readonly requestedBytes: number;
  public readonly transferredBytes: number;
  public readonly readPending: number;
  public readonly hardwareRevision: string;
  public readonly firmwareRevision: string;

  constructor(fields: Mcp2221StatusFields) {
    this.product = fields.product;
    this.speedKhz = fields.speedKhz;
    this.scl = fields.scl;
    this.sda = fields.sda;
    this.requestedBytes = fields.requestedBytes;
    this.transferredBytes = fields.transferredBytes;
    this.readPending = fields.readPending;
    this.hardwareRevision = fields.hardwareRevision;
    this.firmwareRevision = fields.firmwareRevision;
  }

  // Both lines high means no transaction is holding the bus.
  public get busFree(): boolean {
    return this.scl && this.sda;
  }

  public static parse = (product: string, reply: Uint8Array): Mcp2221Status =>
    new Mcp2221Status({
      product,
      // Byte 14 holds the current divider; speed = 12 MHz / (divider + 3).
      speedKhz: Math.round(CLOCK_HZ / (reply[14] + DIVIDER_OFFSET) / 1000),
      scl: reply[22] === 1,
      sda: reply[23] === 1,
      requestedBytes: reply[9] | (reply[10] << 8),
      transferredBytes: reply[11] | (reply[12] << 8),
      readPending: reply[25],
      hardwareRevision: String.fromCharCode(reply[46], reply[47]),
      firmwareRevision: String.fromCharCode(reply[48], reply[49]),
    });
}
