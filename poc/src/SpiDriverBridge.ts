import type { Bridge } from "./Bridge.js";
import type { SpiBus } from "./SpiBus.js";
import { ByteChannel, type ChannelIO } from "./ByteChannel.js";
import { ExcameraLink } from "./ExcameraLink.js";
import { WebSerialTransport } from "./WebSerialTransport.js";
import { SpiDriverStatus } from "./SpiDriverStatus.js";

const BAUD_RATE = 460800;

// 0x00 is an ignored command; 66 of them complete any half-received command.
const RECOVERY_BYTES = new Array(66).fill(0x00);

// Single-byte commands of the raw serial protocol (User Guide §7.4).
const COMMAND = {
  setA: 0x61, // 'a'
  setB: 0x62, // 'b'
  setMode: 0x6d, // 'm'
  select: 0x73, // 's'
  unselect: 0x75, // 'u'
  detach: 0x78, // 'x'
  transferBase: 0x80, // 0x80-0xbf: write and read 1-64 bytes
  writeBase: 0xc0, // 0xc0-0xff: write 1-64 bytes
} as const;

// Bridge for the Excamera Labs SPIDriver: turns a byte channel into a SpiBus,
// hiding the chipset-specific command format.
export class SpiDriverBridge implements SpiBus, Bridge<SpiDriverStatus> {
  private link: ExcameraLink;

  constructor(channel: ByteChannel) {
    this.link = new ExcameraLink(channel, RECOVERY_BYTES);
  }

  public static fromPort = (port: SerialPort): SpiDriverBridge =>
    new SpiDriverBridge(new ByteChannel(new WebSerialTransport(port, BAUD_RATE)));

  public open = (): Promise<void> => this.link.open();

  public close = (): Promise<void> => this.link.close();

  public verifyLink = (): Promise<void> => this.link.verify();

  public onDisconnect = (handler: () => void): void => this.link.onDisconnect(handler);

  public status = async (): Promise<SpiDriverStatus> =>
    SpiDriverStatus.parse(await this.link.statusRecord());

  // --- SpiBus ---

  // SPI mode 0-3 (CPOL/CPHA); SPIDriver2 only, default 0.
  public configure = async (mode: number): Promise<void> => {
    await this.link.channel.exchange([COMMAND.setMode, mode]);
  };

  public select = async (): Promise<void> => {
    await this.link.channel.exchange([COMMAND.select]);
  };

  public deselect = async (): Promise<void> => {
    await this.link.channel.exchange([COMMAND.unselect]);
  };

  // Full-duplex transfer without touching CS.
  public transfer = (bytes: ArrayLike<number>): Promise<Uint8Array> => {
    const payload = Uint8Array.from(bytes);
    return this.link.channel.transact((io) => this.clockThrough(io, payload));
  };

  // Write-only transfer: input data is discarded, so nothing is read back.
  public write = (bytes: ArrayLike<number>): Promise<void> => {
    const payload = Uint8Array.from(bytes);
    return this.link.channel.transact(async (io) => {
      for (const [, chunk] of ExcameraLink.chunked(payload)) {
        await io.write([COMMAND.writeBase + chunk.length - 1, ...chunk]);
      }
    });
  };

  // Read-only transfer: clocks out zero filler bytes.
  public read = (count: number): Promise<Uint8Array> => this.transfer(new Uint8Array(count));

  // --- SPIDriver extras beyond the SpiBus contract ---

  public setA = async (on: boolean): Promise<void> => {
    await this.link.channel.exchange([COMMAND.setA, on ? 1 : 0]);
  };

  public setB = async (on: boolean): Promise<void> => {
    await this.link.channel.exchange([COMMAND.setB, on ? 1 : 0]);
  };

  // Disconnect from the SPI bus: tri-state the output pins so another
  // master can drive the target. Any later command re-engages the bus.
  public detach = async (): Promise<void> => {
    await this.link.channel.exchange([COMMAND.detach]);
  };

  private clockThrough = async (io: ChannelIO, bytes: Uint8Array): Promise<Uint8Array> => {
    const reply = new Uint8Array(bytes.length);
    for (const [offset, chunk] of ExcameraLink.chunked(bytes)) {
      await io.write([COMMAND.transferBase + chunk.length - 1, ...chunk]);
      reply.set(await io.read(chunk.length), offset);
    }
    return reply;
  };
}
