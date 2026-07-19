import type { HostTransport } from "./HostTransport.js";

// Host transport over the Web Serial API. Moves bytes only: no knowledge of
// SPI, I2C, commands, or devices. Owns unplug detection so no other layer
// ever needs to see the SerialPort.
export class WebSerialTransport implements HostTransport {
  private port: SerialPort;
  private baudRate: number;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private disconnectHandlers: (() => void)[] = [];

  constructor(port: SerialPort, baudRate: number) {
    this.port = port;
    this.baudRate = baudRate;
    navigator.serial?.addEventListener("disconnect", (event) => this.handleUnplug(event));
  }

  public connect = async (): Promise<void> => {
    await this.port.open({ baudRate: this.baudRate });
    this.writer = this.openWritable().getWriter();
    this.reader = this.openReadable().getReader();
  };

  public disconnect = async (): Promise<void> => {
    await this.reader?.cancel().catch(() => {});
    this.writer?.releaseLock();
    this.reader = null;
    this.writer = null;
    await this.port.close().catch(() => {});
  };

  public write = (bytes: Uint8Array): Promise<void> => {
    if (!this.writer) throw new Error("Transport is not connected");
    return this.writer.write(bytes);
  };

  public read = async (): Promise<Uint8Array | null> => {
    if (!this.reader) throw new Error("Transport is not connected");
    const result = await this.reader.read();
    return result.done ? null : result.value;
  };

  public onDisconnect = (handler: () => void): void => {
    this.disconnectHandlers.push(handler);
  };

  private openWritable = (): WritableStream<Uint8Array> => {
    if (!this.port.writable) throw new Error("Serial port is not writable");
    return this.port.writable;
  };

  private openReadable = (): ReadableStream<Uint8Array> => {
    if (!this.port.readable) throw new Error("Serial port is not readable");
    return this.port.readable;
  };

  private handleUnplug = (event: Event): void => {
    if (event.target !== this.port) return;
    for (const handler of this.disconnectHandlers) handler();
  };
}
