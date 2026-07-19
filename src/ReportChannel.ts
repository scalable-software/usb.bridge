import type { HostTransport } from "./HostTransport.js";

const REPORT_LENGTH = 64;
const TIMED_OUT = Symbol("timed out");
const STALE_QUIET_MS = 10;

// The command primitive handed to a transaction while it holds the channel.
export interface ReportIO {
  // Send one command report (padded to 64 bytes) and await its response report.
  command(bytes: ArrayLike<number>): Promise<Uint8Array>;
}

// Serialized request/response framing over a packet-based host transport:
// every command report gets exactly one response report, and concurrent
// callers never interleave their exchanges. Timeout injectable for tests.
export class ReportChannel {
  private transport: HostTransport;
  private replyTimeoutMs: number;
  private pendingRead: Promise<Uint8Array | null> | null = null;
  private staleReply = false;
  private queue: Promise<unknown> = Promise.resolve();
  private io: ReportIO = {
    command: (bytes) => this.command(bytes),
  };

  constructor(transport: HostTransport, replyTimeoutMs = 1000) {
    this.transport = transport;
    this.replyTimeoutMs = replyTimeoutMs;
  }

  public open = (): Promise<void> => this.transport.connect();

  public close = (): Promise<void> => this.transport.disconnect();

  public onDisconnect = (handler: () => void): void => this.transport.onDisconnect(handler);

  // Run a multi-command sequence with exclusive access to the channel.
  public transact = <T>(action: (io: ReportIO) => Promise<T>): Promise<T> =>
    this.enqueue(() => action(this.io));

  // The common case: a single command/response exchange.
  public exchange = (bytes: ArrayLike<number>): Promise<Uint8Array> =>
    this.transact((io) => io.command(bytes));

  private enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = this.queue.then(action);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  private command = async (bytes: ArrayLike<number>): Promise<Uint8Array> => {
    // A reply that arrived after its exchange timed out would pair with the
    // wrong command; discard leftovers before starting a fresh exchange.
    if (this.staleReply) await this.discardStale();
    const report = new Uint8Array(REPORT_LENGTH);
    report.set(Uint8Array.from(bytes));
    await this.transport.write(report);
    const reply = await this.nextReport(this.replyTimeoutMs);
    if (reply === TIMED_OUT) {
      this.staleReply = true;
      throw new Error(`Timed out waiting for a response to command 0x${report[0].toString(16)}`);
    }
    return reply;
  };

  private discardStale = async (): Promise<void> => {
    while ((await this.nextReport(STALE_QUIET_MS)) !== TIMED_OUT) {
      // keep discarding until the line goes quiet
    }
    this.staleReply = false;
  };

  private nextReport = async (timeoutMs: number): Promise<Uint8Array | typeof TIMED_OUT> => {
    // Keep the in-flight read across timeouts so no report is ever dropped.
    this.pendingRead ??= this.transport.read();
    const result = await Promise.race([this.pendingRead, this.quiet(timeoutMs)]);
    if (result === TIMED_OUT) return TIMED_OUT;
    this.pendingRead = null;
    if (result === null) {
      throw new Error("Transport closed while awaiting a response");
    }
    return result;
  };

  private quiet = (ms: number): Promise<typeof TIMED_OUT> =>
    new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms));
}
