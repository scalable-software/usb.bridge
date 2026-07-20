// The six fields every Excamera status record starts with.
export interface CommonStatusFields {
  product: string;
  serial: string;
  uptime: number;
  voltage: number;
  current: number;
  temperature: number;
}

// Base of the 80-character, space-padded, bracket-delimited status records.
// Subclasses parse the device-specific tail.
export class StatusRecord {
  public readonly product: string;
  public readonly serial: string;
  public readonly uptime: number;
  public readonly voltage: number;
  public readonly current: number;
  public readonly temperature: number;

  constructor({ product, serial, uptime, voltage, current, temperature }: CommonStatusFields) {
    this.product = product;
    this.serial = serial;
    this.uptime = uptime;
    this.voltage = voltage;
    this.current = current;
    this.temperature = temperature;
  }

  // Split a record into tokens, requiring at least `count` of them.
  protected static tokens = (record: string, count: number): string[] => {
    const tokens = record.replace(/[[\]]/g, "").trim().split(/\s+/);
    if (tokens.length < count) {
      throw new Error(`Malformed status record: "${record.trim()}"`);
    }
    return tokens;
  };

  protected static common = (tokens: string[]): CommonStatusFields => {
    const [product, serial, uptime, voltage, current, temperature] = tokens;
    return {
      product,
      serial,
      uptime: Number(uptime),
      voltage: Number(voltage),
      current: Number(current),
      temperature: Number(temperature),
    };
  };
}
