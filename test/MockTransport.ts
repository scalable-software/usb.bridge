import type { HostTransport } from "../dist/HostTransport.js";

// One scripted step: an expected write (omit `expect` to accept anything)
// and the reply chunks the device sends back for it.
export interface Exchange {
  expect?: number[];
  reply?: number[][];
}

// Scripted host transport: verifies what a bridge writes and plays back the
// device's replies, chunked however the script says — the transport contract
// makes no promises about chunk boundaries.
export class MockTransport implements HostTransport {
  public written: number[][] = [];
  public connected = false;
  private script: Exchange[];
  private queued: Uint8Array[] = [];
  private waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private disconnectHandlers: (() => void)[] = [];

  constructor(script: Exchange[] = []) {
    this.script = script;
  }

  public connect = async (): Promise<void> => {
    this.connected = true;
  };

  public disconnect = async (): Promise<void> => {
    this.connected = false;
  };

  public write = async (bytes: Uint8Array): Promise<void> => {
    const sent = Array.from(bytes);
    this.written.push(sent);
    const step = this.script.shift();
    if (!step) return;
    if (step.expect && JSON.stringify(step.expect) !== JSON.stringify(sent)) {
      throw new Error(`Unexpected write: sent [${sent}], script expected [${step.expect}]`);
    }
    for (const chunk of step.reply ?? []) {
      this.deliver(Uint8Array.from(chunk));
    }
  };

  public read = (): Promise<Uint8Array | null> => {
    const chunk = this.queued.shift();
    if (chunk) return Promise.resolve(chunk);
    return new Promise((resolve) => this.waiters.push(resolve));
  };

  public onDisconnect = (handler: () => void): void => {
    this.disconnectHandlers.push(handler);
  };

  // Test hooks
  public unplug = (): void => this.disconnectHandlers.forEach((handler) => handler());

  public deliver = (chunk: Uint8Array): void => {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
    } else {
      this.queued.push(chunk);
    }
  };
}
