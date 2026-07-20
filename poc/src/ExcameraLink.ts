import type { ByteChannel } from "./ByteChannel.js";

const STATUS_LENGTH = 80;
const MAX_CHUNK = 64;

// Commands shared by every Excamera board.
const COMMAND = {
  status: 0x3f, // '?'
  echo: 0x65, // 'e'
} as const;

// Behaviours shared by every Excamera board, composed into each bridge:
// lifecycle, link verification with self-healing, and the raw status record.
export class ExcameraLink {
  public readonly channel: ByteChannel;
  private recoveryBytes: number[];

  constructor(channel: ByteChannel, recoveryBytes: number[]) {
    this.channel = channel;
    this.recoveryBytes = recoveryBytes;
  }

  public open = (): Promise<void> => this.channel.open();

  public close = (): Promise<void> => this.channel.close();

  public onDisconnect = (handler: () => void): void => this.channel.onDisconnect(handler);

  // Prove the link end-to-end before trusting it: clear anything a confused
  // device left queued, then require two exact echo round-trips.
  public verify = async (): Promise<void> => {
    await this.flush();
    await this.echo(0x55);
    await this.echo(0xaa);
  };

  // Recover a device stuck awaiting the rest of a half-received command
  // (e.g. after wrong-baud garbage): feed it a full command's worth of
  // harmless padding, then discard whatever replies it queued.
  public flush = async (): Promise<void> => {
    await this.channel.exchange(this.recoveryBytes);
    await this.channel.drain();
  };

  // Echo test: the device returns the byte unchanged.
  public echo = async (byte: number): Promise<void> => {
    const [reply] = await this.channel.exchange([COMMAND.echo, byte], 1);
    if (reply !== byte) {
      throw new Error(`Echo mismatch: sent ${byte}, received ${reply}`);
    }
  };

  // The raw 80-character status record; each bridge parses its own format.
  public statusRecord = async (): Promise<string> => {
    const record = await this.channel.exchange([COMMAND.status], STATUS_LENGTH);
    return new TextDecoder().decode(record);
  };

  // Both protocols carry at most 64 payload bytes per command.
  // (A generator cannot be an arrow function, so this stays a method.)
  public static *chunked(bytes: Uint8Array): Generator<[number, Uint8Array]> {
    for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK) {
      yield [offset, bytes.slice(offset, offset + MAX_CHUNK)];
    }
  }
}
