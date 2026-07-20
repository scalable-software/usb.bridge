import type { Bridge } from "./Bridge.js";
import type { I2cBus, I2cSpeed } from "./I2cBus.js";
import { ByteChannel, type ChannelIO } from "./ByteChannel.js";
import { ExcameraLink } from "./ExcameraLink.js";
import { WebSerialTransport } from "./WebSerialTransport.js";
import { I2cDriverStatus } from "./I2cDriverStatus.js";

const BAUD_RATE = 1_000_000;
const MAX_CHUNK = 64;

const SCAN_FIRST_ADDRESS = 0x08;
const SCAN_ADDRESS_COUNT = 112;

// 0x40 pads a half-received command and ends any bitbang control sequence;
// 0x20 exits monitor mode; 'i' (0x69) returns to I2C mode. All are no-ops
// on a healthy idle device.
const RECOVERY_BYTES = [...new Array(66).fill(0x40), 0x20, 0x69];

// Single-byte commands of the raw serial protocol (User Guide §7.4).
const COMMAND = {
  speed100: 0x31, // '1'
  speed400: 0x34, // '4'
  start: 0x73, // 's'
  stop: 0x70, // 'p'
  reset: 0x78, // 'x'
  ackRead: 0x61, // 'a': read N bytes, ACK every byte
  registerRead: 0x72, // 'r'
  scan: 0x64, // 'd': probe addresses 0x08-0x77
  pullups: 0x75, // 'u'
  readBase: 0x80, // 0x80-0xbf: read 1-64 bytes, NACK the final byte
  writeBase: 0xc0, // 0xc0-0xff: write 1-64 bytes
} as const;

// Outcome bits reported after START, writes, and each scanned address.
export interface BusResult {
  acked: boolean;
  timedOut: boolean;
  arbitrationLost: boolean;
}

// Bridge for the Excamera Labs I2CDriver: turns a byte channel into an
// I2cBus, hiding the chipset-specific command format.
export class I2cDriverBridge implements I2cBus, Bridge<I2cDriverStatus> {
  private link: ExcameraLink;

  constructor(channel: ByteChannel) {
    this.link = new ExcameraLink(channel, RECOVERY_BYTES);
  }

  public static fromPort = (port: SerialPort): I2cDriverBridge =>
    new I2cDriverBridge(new ByteChannel(new WebSerialTransport(port, BAUD_RATE)));

  public open = (): Promise<void> => this.link.open();

  public close = (): Promise<void> => this.link.close();

  public verifyLink = (): Promise<void> => this.link.verify();

  public onDisconnect = (handler: () => void): void => this.link.onDisconnect(handler);

  public status = async (): Promise<I2cDriverStatus> =>
    I2cDriverStatus.parse(await this.link.statusRecord());

  // --- I2cBus ---

  // 100 or 400 kHz; the device sends no response.
  public configure = async (speed: I2cSpeed): Promise<void> => {
    await this.link.channel.exchange([speed === 100 ? COMMAND.speed100 : COMMAND.speed400]);
  };

  // A complete write transaction: START, write, STOP.
  // STOP is sent even after a NACK so the bus is always released.
  public write = (device: number, bytes: ArrayLike<number>): Promise<void> => {
    const payload = Uint8Array.from(bytes);
    return this.link.channel.transact(async (io) => {
      try {
        await this.startOn(io, device, false);
        await this.writeOn(io, payload);
      } finally {
        await io.write([COMMAND.stop]);
      }
    });
  };

  // A complete read transaction: START, read with NACK on the final byte, STOP.
  public read = (device: number, count: number): Promise<Uint8Array> =>
    this.link.channel.transact(async (io) => {
      try {
        await this.startOn(io, device, true);
        return await this.readOn(io, count);
      } finally {
        await io.write([COMMAND.stop]);
      }
    });

  // Write then read within one transaction, joined by a repeated START.
  public writeRead = (device: number, bytes: ArrayLike<number>, count: number): Promise<Uint8Array> => {
    const payload = Uint8Array.from(bytes);
    return this.link.channel.transact(async (io) => {
      try {
        await this.startOn(io, device, false);
        await this.writeOn(io, payload);
        await this.startOn(io, device, true);
        return await this.readOn(io, count);
      } finally {
        await io.write([COMMAND.stop]);
      }
    });
  };

  // Probe every address; returns the 7-bit addresses that ACKed.
  public scan = async (): Promise<number[]> => {
    const results = await this.link.channel.exchange([COMMAND.scan], SCAN_ADDRESS_COUNT);
    return Array.from(results)
      .map((byte, index) => (I2cDriverBridge.decodeBus(byte).acked ? SCAN_FIRST_ADDRESS + index : -1))
      .filter((address) => address >= 0);
  };

  // --- I2CDriver extras beyond the I2cBus contract ---

  // START dev+w, write register address, repeated START dev+r, read, STOP.
  public readRegister = (device: number, register: number, count: number): Promise<Uint8Array> =>
    this.link.channel.exchange([COMMAND.registerRead, device, register, count], count);

  // Six control bits: 2.2K/4.3K/4.7K to SDA (bits 0-2) and SCL (bits 3-5).
  public setPullups = async (bits: number): Promise<void> => {
    await this.link.channel.exchange([COMMAND.pullups, bits & 0b111111]);
  };

  // Pulse SCL and send STOP to free a stuck bus; true when both lines are high.
  public reset = async (): Promise<boolean> => {
    const [lines] = await this.link.channel.exchange([COMMAND.reset], 1);
    return (lines & 0b11) === 0b11;
  };

  private startOn = async (io: ChannelIO, device: number, read: boolean): Promise<void> => {
    await io.write([COMMAND.start, ((device & 0x7f) << 1) | (read ? 1 : 0)]);
    const [result] = await io.read(1);
    I2cDriverBridge.requireAck(I2cDriverBridge.decodeBus(result), device);
  };

  private writeOn = async (io: ChannelIO, bytes: Uint8Array): Promise<void> => {
    for (const [, chunk] of ExcameraLink.chunked(bytes)) {
      await io.write([COMMAND.writeBase + chunk.length - 1, ...chunk]);
      const [result] = await io.read(1);
      I2cDriverBridge.requireAck(I2cDriverBridge.decodeBus(result));
    }
  };

  // ACK every byte of the leading chunks; NACK only the final byte of the last.
  private readOn = async (io: ChannelIO, count: number): Promise<Uint8Array> => {
    const reply = new Uint8Array(count);
    let offset = 0;
    while (count - offset > MAX_CHUNK) {
      await io.write([COMMAND.ackRead, MAX_CHUNK]);
      reply.set(await io.read(MAX_CHUNK), offset);
      offset += MAX_CHUNK;
    }
    await io.write([COMMAND.readBase + (count - offset) - 1]);
    reply.set(await io.read(count - offset), offset);
    return reply;
  };

  private static requireAck = (result: BusResult, device?: number): void => {
    if (result.acked) return;
    const target = device === undefined ? "device" : `device 0x${device.toString(16).padStart(2, "0")}`;
    if (result.timedOut) throw new Error(`Transmission to ${target} timed out`);
    if (result.arbitrationLost) throw new Error(`Bus arbitration lost addressing ${target}`);
    throw new Error(`No ACK from ${target}`);
  };

  private static decodeBus = (byte: number): BusResult => ({
    acked: (byte & 0b001) !== 0,
    timedOut: (byte & 0b010) !== 0,
    arbitrationLost: (byte & 0b100) !== 0,
  });
}
