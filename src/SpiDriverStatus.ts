import { StatusRecord, type CommonStatusFields } from "./StatusRecord.js";

export interface SpiDriverStatusFields extends CommonStatusFields {
  cs: boolean;
  a: boolean;
  b: boolean;
  crc: string;
  mode: number | null;
}

const TOKEN_COUNT = 10; // SPIDriver2 appends an 11th token: the SPI mode

// The SPIDriver status record,
// e.g. [spidriver1 DO00QS8D 000007219 4.807 045 25.4 1 1 1 49c1 ]
export class SpiDriverStatus extends StatusRecord {
  public readonly cs: boolean;
  public readonly a: boolean;
  public readonly b: boolean;
  public readonly crc: string;
  public readonly mode: number | null;

  constructor(fields: SpiDriverStatusFields) {
    super(fields);
    this.cs = fields.cs;
    this.a = fields.a;
    this.b = fields.b;
    this.crc = fields.crc;
    this.mode = fields.mode;
  }

  // CS is active low: line state 0 means a target is selected.
  public get selected(): boolean {
    return !this.cs;
  }

  public static parse = (record: string): SpiDriverStatus => {
    const tokens = SpiDriverStatus.tokens(record, TOKEN_COUNT);
    // The User Guide documents the flag order as CS, A, B, but the device
    // actually reports A, B, CS — verified against spidriver1 hardware by
    // toggling each line and watching which token moves.
    const [, , , , , , a, b, cs, crc] = tokens;
    return new SpiDriverStatus({
      ...SpiDriverStatus.common(tokens),
      cs: cs === "1",
      a: a === "1",
      b: b === "1",
      crc,
      mode: tokens.length > TOKEN_COUNT ? Number(tokens[TOKEN_COUNT]) : null,
    });
  };
}
