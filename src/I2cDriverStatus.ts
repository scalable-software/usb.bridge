import { StatusRecord, type CommonStatusFields } from "./StatusRecord.js";

export interface I2cDriverStatusFields extends CommonStatusFields {
  mode: "I2C" | "bitbang";
  sda: boolean;
  scl: boolean;
  speed: number;
  pullups: number;
  crc: string;
}

const TOKEN_COUNT = 12;

// Effective pull-up strength per 3-bit resistor combination (User Guide §7.5).
const PULLUP_STRENGTH = ["none", "2.2K", "4.3K", "1.5K", "4.7K", "1.5K", "2.2K", "1.1K"];

// The I2CDriver status record,
// e.g. [i2cdriver1 DO01JUOO 000000061 4.971 000 23.8 I 1 1 100 24 ffff ]
export class I2cDriverStatus extends StatusRecord {
  public readonly mode: "I2C" | "bitbang";
  public readonly sda: boolean;
  public readonly scl: boolean;
  public readonly speed: number;
  public readonly pullups: number;
  public readonly crc: string;

  constructor(fields: I2cDriverStatusFields) {
    super(fields);
    this.mode = fields.mode;
    this.sda = fields.sda;
    this.scl = fields.scl;
    this.speed = fields.speed;
    this.pullups = fields.pullups;
    this.crc = fields.crc;
  }

  // Both lines high means no transaction is holding the bus.
  public get busFree(): boolean {
    return this.sda && this.scl;
  }

  // SDA pull-up is bits 0-2, SCL pull-up bits 3-5.
  public get sdaPullup(): string {
    return PULLUP_STRENGTH[this.pullups & 0b111];
  }

  public get sclPullup(): string {
    return PULLUP_STRENGTH[(this.pullups >> 3) & 0b111];
  }

  public static parse = (record: string): I2cDriverStatus => {
    const tokens = I2cDriverStatus.tokens(record, TOKEN_COUNT);
    const [, , , , , , mode, sda, scl, speed, pullups, crc] = tokens;
    return new I2cDriverStatus({
      ...I2cDriverStatus.common(tokens),
      mode: mode === "B" ? "bitbang" : "I2C",
      sda: sda === "1",
      scl: scl === "1",
      speed: Number(speed),
      pullups: Number.parseInt(pullups, 16),
      crc,
    });
  };
}
