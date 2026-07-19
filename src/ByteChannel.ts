import type { HostTransport } from "./HostTransport.js";

const TIMED_OUT = Symbol("timed out");

// The write/read pair handed to a transaction while it holds the channel.
export interface ChannelIO {
  write(bytes: ArrayLike<number>): Promise<void>;
  read(count: number): Promise<Uint8Array>;
}

// Byte-exact, serialized command framing over a host transport. Transports
// deliver bytes in arbitrary chunks; this class buffers them so callers can
// read exact counts, and serializes transactions so concurrent callers never
// interleave their write/read pairs. Timeouts are injectable for tests.
export class ByteChannel {
  private transport: HostTransport;
  private readTimeoutMs: number;
  private drainQuietMs: number;
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private pendingRead: Promise<Uint8Array | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private io: ChannelIO = {
    write: (bytes) => this.write(bytes),
    read: (count) => this.readExactly(count),
  };

  constructor(transport: HostTransport, readTimeoutMs = 1000, drainQuietMs = 150) {
    this.transport = transport;
    this.readTimeoutMs = readTimeoutMs;
    this.drainQuietMs = drainQuietMs;
  }

  public open = (): Promise<void> => this.transport.connect();

  public close = (): Promise<void> => this.transport.disconnect();

  public onDisconnect = (handler: () => void): void => this.transport.onDisconnect(handler);

  // Run a multi-step write/read sequence with exclusive access to the channel.
  public transact = <T>(action: (io: ChannelIO) => Promise<T>): Promise<T> =>
    this.enqueue(() => action(this.io));

  // The common case: one write, optionally followed by a fixed-length reply.
  public exchange = (bytes: ArrayLike<number>, replyLength = 0): Promise<Uint8Array> =>
    this.transact(async (io) => {
      await io.write(bytes);
      return replyLength ? io.read(replyLength) : new Uint8Array(0);
    });

  // Discard whatever a confused device left queued: stale replies would
  // otherwise offset every later read by that many bytes.
  public drain = (): Promise<void> =>
    this.transact(async () => {
      this.chunks = [];
      this.buffered = 0;
      while (true) {
        this.pendingRead ??= this.transport.read();
        const result = await Promise.race([this.pendingRead, this.quiet(this.drainQuietMs)]);
        if (result === TIMED_OUT) return; // silence: the in-flight read stays parked
        this.pendingRead = null;
        if (result === null) return;
      }
    });

  private enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = this.queue.then(action);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  private write = (bytes: ArrayLike<number>): Promise<void> =>
    this.transport.write(new Uint8Array(bytes));

  private readExactly = async (count: number): Promise<Uint8Array> => {
    while (this.buffered < count) {
      this.store(await this.nextChunk(count));
    }
    return this.consume(count);
  };

  private nextChunk = async (expected: number): Promise<Uint8Array> => {
    // Keep the in-flight read across timeouts so no chunk is ever dropped.
    this.pendingRead ??= this.transport.read();
    const result = await Promise.race([this.pendingRead, this.quiet(this.readTimeoutMs)]);
    if (result === TIMED_OUT) {
      throw new Error(`Timed out waiting for ${expected} bytes (got ${this.buffered})`);
    }
    this.pendingRead = null;
    if (result === null) {
      throw new Error("Transport closed while reading");
    }
    return result;
  };

  private quiet = (ms: number): Promise<typeof TIMED_OUT> =>
    new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms));

  private store = (chunk: Uint8Array): void => {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
  };

  private consume = (count: number): Uint8Array => {
    const all = new Uint8Array(this.buffered);
    let offset = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const rest = all.subarray(count);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    return all.subarray(0, count);
  };
}
