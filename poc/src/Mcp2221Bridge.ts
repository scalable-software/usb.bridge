import type { Bridge } from "./Bridge.js";
import type { I2cBus, I2cSpeed } from "./I2cBus.js";
import { ReportChannel, type ReportIO } from "./ReportChannel.js";
import { WebHidTransport } from "./WebHidTransport.js";
import { Mcp2221Status } from "./Mcp2221Status.js";

const CLOCK_HZ = 12_000_000;
const DIVIDER_OFFSET = 3;
const MAX_CHUNK = 60; // data bytes per report
const BUSY_RETRIES = 50;
const COMPLETION_POLLS = 40;

const SCAN_FIRST_ADDRESS = 0x08;
const SCAN_LAST_ADDRESS = 0x77;
const PROBE_POLLS = 8; // short poll budget per scanned address

// Command codes (MCP2221A datasheet §3.1).
const COMMAND = {
  status: 0x10, // doubles as cancel (byte 2) and set-speed (bytes 3-4)
  getI2cData: 0x40,
  reset: 0x70, // 0x70 0xAB 0xCD 0xEF: reboot the chip (USB re-enumerates)
  write: 0x90, // START + write + STOP
  read: 0x91, // START + read + STOP
  readRepeatedStart: 0x93,
  writeNoStop: 0x94,
} as const;

const RESULT = {
  ok: 0x00,
  busy: 0x01, // I2C engine busy, command not accepted
  readError: 0x41, // error reading slave data from the engine
} as const;

const SUBCOMMAND = {
  cancel: 0x10,
  setSpeed: 0x20,
} as const;

const SPEED_ACCEPTED = 0x20;
const NO_READ_DATA = 127; // "count" value signalling no valid data
const ENGINE_IDLE = 0x00;

// Bridge for the Microchip MCP2221: turns a HID report channel into an I2cBus,
// hiding the chipset-specific report formats. Hard-won hardware quirks:
// the I2C engine does not self-recover from a NACKed address (it must be
// cancelled), and cancelling an already-IDLE engine is itself what wedges it —
// so state is always checked before cancelling, and a wedged engine gets a
// full chip reset as the last resort.
export class Mcp2221Bridge implements I2cBus, Bridge<Mcp2221Status> {
  private channel: ReportChannel;
  private product: string;
  private speed: I2cSpeed;

  constructor(channel: ReportChannel, product: string, speed: I2cSpeed = 100) {
    this.channel = channel;
    this.product = product;
    this.speed = speed;
  }

  public static fromDevice = (device: HIDDevice): Mcp2221Bridge =>
    new Mcp2221Bridge(new ReportChannel(new WebHidTransport(device)), device.productName);

  // Open the transport, free any transfer a previous session left behind,
  // then apply the configured bus speed (bridge initialization: bus timing
  // is chipset knowledge).
  public open = async (): Promise<void> => {
    await this.channel.open();
    await this.recoverEngine();
    await this.configure(this.speed);
  };

  public close = (): Promise<void> => this.channel.close();

  public onDisconnect = (handler: () => void): void => this.channel.onDisconnect(handler);

  // The status round-trip (echoed command code + success) proves the link.
  public verifyLink = async (): Promise<void> => {
    const reply = await this.channel.exchange([COMMAND.status]);
    Mcp2221Bridge.requireOk(reply, COMMAND.status);
  };

  public status = async (): Promise<Mcp2221Status> => {
    const reply = await this.channel.exchange([COMMAND.status]);
    Mcp2221Bridge.requireOk(reply, COMMAND.status);
    return Mcp2221Status.parse(this.product, reply);
  };

  // Cancel the current transfer and free the bus. Safe here: the UI offers
  // it for stuck transfers, when the engine is genuinely non-idle.
  public cancel = async (): Promise<void> => {
    const reply = await this.channel.exchange([COMMAND.status, 0, SUBCOMMAND.cancel]);
    Mcp2221Bridge.requireOk(reply, COMMAND.status);
  };

  // --- I2cBus ---

  // 100 or 400 kHz via the 12 MHz clock divider. The engine rejects the
  // setting while it considers a transfer in progress — including for a few
  // hundred microseconds after a cancel — so retry, re-cancelling as we go.
  public configure = (speed: I2cSpeed): Promise<void> =>
    this.channel.transact(async (io) => {
      const divider = CLOCK_HZ / (speed * 1000) - DIVIDER_OFFSET;
      for (let attempt = 0; attempt < 10; attempt++) {
        const reply = await io.command([COMMAND.status, 0, 0, SUBCOMMAND.setSpeed, divider]);
        Mcp2221Bridge.requireOk(reply, COMMAND.status);
        if (reply[3] === SPEED_ACCEPTED) {
          this.speed = speed;
          return;
        }
        await this.cancelOn(io);
        await Mcp2221Bridge.pause(5);
      }
      throw new Error("Bus speed not accepted (an I2C transfer is stuck — try Free bus)");
    });

  // A complete write transaction: START, data, STOP.
  public write = (device: number, bytes: ArrayLike<number>): Promise<void> => {
    const payload = Uint8Array.from(bytes);
    return this.channel.transact(async (io) => {
      await this.writeOn(io, COMMAND.write, device << 1, payload);
      await this.awaitWriteCompletion(io, device, payload.length);
    });
  };

  // A complete read transaction: START, read, STOP.
  public read = (device: number, count: number): Promise<Uint8Array> =>
    this.channel.transact(async (io) => {
      await this.startReadOn(io, COMMAND.read, device, count);
      return this.collectOn(io, device, count);
    });

  // Write then read joined by a repeated START (register-read pattern):
  // the write sends no STOP, keeping the bus for the read.
  public writeRead = (device: number, bytes: ArrayLike<number>, count: number): Promise<Uint8Array> => {
    const payload = Uint8Array.from(bytes);
    return this.channel.transact(async (io) => {
      await this.writeOn(io, COMMAND.writeNoStop, device << 1, payload);
      await this.awaitWriteCompletion(io, device, payload.length);
      await this.startReadOn(io, COMMAND.readRepeatedStart, device, count);
      return this.collectOn(io, device, count);
    });
  };

  // The MCP2221 has no native scan command, so probe every address with a
  // one-byte read and see who ACKs. Held in a single transaction so status
  // polling never interleaves with the probes.
  public scan = (): Promise<number[]> =>
    this.channel.transact(async (io) => {
      const found: number[] = [];
      for (let address = SCAN_FIRST_ADDRESS; address <= SCAN_LAST_ADDRESS; address++) {
        if (await this.probeOn(io, address)) found.push(address);
      }
      return found;
    });

  // --- write path ---

  private writeOn = async (io: ReportIO, command: number, address8: number, payload: Uint8Array): Promise<void> => {
    for (let offset = 0; offset < payload.length || offset === 0; offset += MAX_CHUNK) {
      const chunk = payload.subarray(offset, offset + MAX_CHUNK);
      await this.acceptedOn(io, [command, payload.length & 0xff, payload.length >> 8, address8, ...chunk], command);
      if (payload.length === 0) break;
    }
  };

  // The "accepted" reply only means the engine took the data; poll until the
  // bytes actually made it onto the bus, else the address was NACKed.
  private awaitWriteCompletion = async (io: ReportIO, device: number, length: number): Promise<void> => {
    for (let poll = 0; poll < COMPLETION_POLLS; poll++) {
      const reply = await io.command([COMMAND.status]);
      Mcp2221Bridge.requireOk(reply, COMMAND.status);
      const requested = reply[9] | (reply[10] << 8);
      const transferred = reply[11] | (reply[12] << 8);
      if (requested === length && transferred === length) return;
      await Mcp2221Bridge.pause(2);
    }
    await this.cancelOn(io);
    throw new Error(`Device 0x${device.toString(16).padStart(2, "0")} did not acknowledge (transfer cancelled)`);
  };

  // --- read path ---

  private startReadOn = async (io: ReportIO, command: number, device: number, count: number): Promise<void> => {
    await this.acceptedOn(io, [command, count & 0xff, count >> 8, (device << 1) | 1], command);
  };

  private collectOn = async (io: ReportIO, device: number, count: number): Promise<Uint8Array> => {
    const received: number[] = [];
    for (let poll = 0; poll < COMPLETION_POLLS && received.length < count; poll++) {
      const reply = await io.command([COMMAND.getI2cData]);
      if (reply[1] === RESULT.readError || reply[3] === NO_READ_DATA) {
        await Mcp2221Bridge.pause(2);
        continue; // engine still clocking — or a NACK, which the poll cap turns into an error
      }
      Mcp2221Bridge.requireOk(reply, COMMAND.getI2cData);
      received.push(...Array.from(reply.subarray(4, 4 + reply[3])));
    }
    if (received.length < count) {
      await this.cancelOn(io);
      throw new Error(`Device 0x${device.toString(16).padStart(2, "0")} did not acknowledge (transfer cancelled)`);
    }
    return Uint8Array.from(received);
  };

  // A scan probe: one-byte read with a short poll budget; NACK leaves the
  // engine stuck, so cancel before moving to the next address.
  private probeOn = async (io: ReportIO, device: number): Promise<boolean> => {
    await this.acceptedOn(io, [COMMAND.read, 1, 0, (device << 1) | 1], COMMAND.read);
    for (let poll = 0; poll < PROBE_POLLS; poll++) {
      const reply = await io.command([COMMAND.getI2cData]);
      if (reply[1] === RESULT.ok && reply[3] !== NO_READ_DATA && reply[3] > 0) return true;
      await Mcp2221Bridge.pause(1);
    }
    await this.cancelOn(io);
    return false;
  };

  // --- shared plumbing ---

  private recoverEngine = (): Promise<void> =>
    this.channel.transact(async (io) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const reply = await io.command([COMMAND.status]);
        Mcp2221Bridge.requireOk(reply, COMMAND.status);
        // Byte 8 is officially "don't care" but carries the I2C state
        // machine's state; 0x00 is idle (verified on hardware). Check BEFORE
        // cancelling: cancelling an already-idle engine is itself what wedges
        // it into a non-idle state that rejects every speed change.
        if (reply[8] === ENGINE_IDLE) return;
        await this.cancelOn(io);
        await Mcp2221Bridge.pause(20);
      }
      // Still wedged: reboot the chip. It re-enumerates on USB, so this
      // connection dies — the app reconnects when the device comes back.
      await io.command([COMMAND.reset, 0xab, 0xcd, 0xef]).catch(() => {});
      throw new Error("I2C engine was stuck; chip reset issued — reconnecting shortly");
    });

  private acceptedOn = async (io: ReportIO, bytes: number[], command: number): Promise<void> => {
    for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
      const reply = await io.command(bytes);
      if (reply[1] !== RESULT.busy) {
        Mcp2221Bridge.requireOk(reply, command);
        return;
      }
      await Mcp2221Bridge.pause(2);
    }
    await this.cancelOn(io);
    throw new Error("I2C engine stayed busy (transfer cancelled)");
  };

  private cancelOn = async (io: ReportIO): Promise<void> => {
    await io.command([COMMAND.status, 0, SUBCOMMAND.cancel]).catch(() => {});
  };

  private static requireOk = (reply: Uint8Array, command: number): void => {
    if (reply[0] !== command) {
      throw new Error(`Response 0x${reply[0].toString(16)} does not match command 0x${command.toString(16)}`);
    }
    if (reply[1] !== RESULT.ok) {
      throw new Error(`Command 0x${command.toString(16)} failed with code 0x${reply[1].toString(16)}`);
    }
  };

  private static pause = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
}
