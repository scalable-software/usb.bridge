import type { HostTransport } from "./HostTransport.js";

// Host transport over the WebHID API. HID is packet-based: each write sends
// one output report and each read resolves with one complete input report,
// so unlike a serial stream, chunk boundaries are guaranteed. Owns unplug
// detection so no other layer ever needs to see the HIDDevice.
export class WebHidTransport implements HostTransport {
  public readonly productName: string;
  private device: HIDDevice;
  private queued: Uint8Array[] = [];
  private waiters: ((report: Uint8Array | null) => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

  constructor(device: HIDDevice) {
    this.device = device;
    this.productName = device.productName;
    this.device.addEventListener("inputreport", (event) => this.deliver(event));
    navigator.hid?.addEventListener("disconnect", (event) => this.handleUnplug(event));
  }

  public connect = async (): Promise<void> => {
    if (!this.device.opened) await this.device.open();
  };

  public disconnect = async (): Promise<void> => {
    await this.device.close().catch(() => {});
    for (const waiter of this.waiters.splice(0)) waiter(null);
  };

  // The MCP2210 uses no report IDs, hence reportId 0. The copy guarantees an
  // ArrayBuffer-backed view, which sendReport's typing requires.
  public write = (bytes: Uint8Array): Promise<void> =>
    this.device.sendReport(0, new Uint8Array(bytes));

  public read = (): Promise<Uint8Array | null> => {
    const report = this.queued.shift();
    if (report) return Promise.resolve(report);
    return new Promise((resolve) => this.waiters.push(resolve));
  };

  public onDisconnect = (handler: () => void): void => {
    this.disconnectHandlers.push(handler);
  };

  private deliver = (event: HIDInputReportEvent): void => {
    const report = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(report);
    } else {
      this.queued.push(report);
    }
  };

  private handleUnplug = (event: HIDConnectionEvent): void => {
    if (event.device !== this.device) return;
    for (const handler of this.disconnectHandlers) handler();
  };
}
