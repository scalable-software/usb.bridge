import { HexCodec } from "./HexCodec.js";
import { TransactionLog } from "./TransactionLog.js";
import type { StatusLine } from "./StatusLine.js";

export interface BusActions {
  write(device: number, bytes: number[]): Promise<boolean>;
  read(device: number, count: number): Promise<Uint8Array | null>;
  writeRead(device: number, bytes: number[], count: number): Promise<Uint8Array | null>;
}

export interface I2CConsoleElements {
  device: HTMLInputElement;
  payload: HTMLInputElement;
  count: HTMLInputElement;
  writeButton: HTMLButtonElement;
  readButton: HTMLButtonElement;
  writeReadButton: HTMLButtonElement;
  log: HTMLOListElement;
}

const FIRST_ADDRESS = 0x00;
const LAST_ADDRESS = 0x7f;
const MAX_READ = 256;

// Device address, payload, and read-count inputs with the transaction log.
export class I2CConsole {
  private device: HTMLInputElement;
  private payload: HTMLInputElement;
  private count: HTMLInputElement;
  private log: TransactionLog;
  private actions: BusActions;
  private statusLine: StatusLine;

  constructor(elements: I2CConsoleElements, actions: BusActions, statusLine: StatusLine) {
    this.device = elements.device;
    this.payload = elements.payload;
    this.count = elements.count;
    this.log = new TransactionLog(elements.log);
    this.actions = actions;
    this.statusLine = statusLine;
    this.wire(elements);
  }

  public clear = (): void => this.log.clear();

  private wire = (elements: I2CConsoleElements): void => {
    elements.writeButton.addEventListener("click", () => this.submitWrite());
    elements.readButton.addEventListener("click", () => this.submitRead());
    elements.writeReadButton.addEventListener("click", () => this.submitWriteRead());
  };

  private submitWrite = async (): Promise<void> => {
    const request = this.parse({ payload: true });
    if (!request) return;
    const acked = await this.actions.write(request.device, request.bytes);
    if (acked) this.append(request.device, `W ${HexCodec.encode(request.bytes)}`, "acked");
  };

  private submitRead = async (): Promise<void> => {
    const request = this.parse({ count: true });
    if (!request) return;
    const reply = await this.actions.read(request.device, request.count);
    if (reply) this.append(request.device, `R ${request.count}`, HexCodec.encode(reply));
  };

  private submitWriteRead = async (): Promise<void> => {
    const request = this.parse({ payload: true, count: true });
    if (!request) return;
    const reply = await this.actions.writeRead(request.device, request.bytes, request.count);
    if (reply) this.append(request.device, `W ${HexCodec.encode(request.bytes)} R ${request.count}`, HexCodec.encode(reply));
  };

  private parse = (need: { payload?: boolean; count?: boolean }): { device: number; bytes: number[]; count: number } | null => {
    try {
      return {
        device: this.parseDevice(),
        bytes: need.payload ? this.parsePayload() : [],
        count: need.count ? this.parseCount() : 0,
      };
    } catch (error) {
      this.statusLine.show(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  private parseDevice = (): number => {
    const bytes = HexCodec.decode(this.device.value);
    if (bytes.length !== 1 || bytes[0] < FIRST_ADDRESS || bytes[0] > LAST_ADDRESS) {
      throw new Error("Device address must be one hex byte between 00 and 7F");
    }
    return bytes[0];
  };

  private parsePayload = (): number[] => {
    const bytes = HexCodec.decode(this.payload.value);
    if (!bytes.length) throw new Error("Enter hex bytes to write, e.g. 00 10");
    return bytes;
  };

  private parseCount = (): number => {
    const count = Number(this.count.value);
    if (!Number.isInteger(count) || count < 1 || count > MAX_READ) {
      throw new Error(`Read count must be 1-${MAX_READ}`);
    }
    return count;
  };

  private append = (device: number, request: string, reply: string): void =>
    this.log.append(`0x${HexCodec.encode([device])}  ${request}  →  ${reply}`);
}
