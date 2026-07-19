import { HexCodec } from "./HexCodec.js";
import { TransactionLog } from "./TransactionLog.js";
import type { StatusLine } from "./StatusLine.js";

export type Transfer = (bytes: number[]) => Promise<Uint8Array | null>;

export interface TransferElements {
  input: HTMLInputElement;
  button: HTMLButtonElement;
  log: HTMLOListElement;
}

// Hex input, transfer button, and the MOSI/MISO exchange log.
export class TransferConsole {
  private input: HTMLInputElement;
  private log: TransactionLog;
  private transfer: Transfer;
  private statusLine: StatusLine;

  constructor({ input, button, log }: TransferElements, transfer: Transfer, statusLine: StatusLine) {
    this.input = input;
    this.log = new TransactionLog(log);
    this.transfer = transfer;
    this.statusLine = statusLine;
    this.wire(button);
  }

  public clear = (): void => this.log.clear();

  private wire = (button: HTMLButtonElement): void => {
    button.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.submit();
    });
  };

  private submit = async (): Promise<void> => {
    const bytes = this.parseInput();
    if (!bytes?.length) return;
    const reply = await this.transfer(bytes);
    if (reply) this.log.append(`MOSI ${HexCodec.encode(bytes)}  →  MISO ${HexCodec.encode(reply)}`);
  };

  private parseInput = (): number[] | null => {
    try {
      return HexCodec.decode(this.input.value);
    } catch (error) {
      this.statusLine.show(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
}
