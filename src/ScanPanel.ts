import { HexCodec } from "./HexCodec.js";

// The bus-scan button and its result line.
export class ScanPanel {
  private button: HTMLButtonElement;
  private results: HTMLElement;
  private scan: () => Promise<number[] | null>;

  constructor(button: HTMLButtonElement, results: HTMLElement, scan: () => Promise<number[] | null>) {
    this.button = button;
    this.results = results;
    this.scan = scan;
    this.button.addEventListener("click", () => this.run());
  }

  public clear = (): void => {
    this.results.textContent = "";
  };

  private run = async (): Promise<void> => {
    this.results.textContent = "Scanning…";
    const addresses = await this.scan();
    if (addresses) {
      this.show(addresses);
    } else {
      this.results.textContent = "Scan failed — see the status line above";
    }
  };

  private show = (addresses: number[]): void => {
    this.results.textContent = addresses.length
      ? `Devices: ${addresses.map((address) => `0x${HexCodec.encode([address])}`).join(", ")}`
      : "No devices found (addresses 0x08–0x77)";
  };
}
