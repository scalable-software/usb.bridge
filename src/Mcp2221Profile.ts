import { Dom } from "./Dom.js";
import type { Device, DeviceProfile, Panel } from "./Device.js";
import { Mcp2221Bridge } from "./Mcp2221Bridge.js";
import type { Mcp2221Status } from "./Mcp2221Status.js";
import type { I2cSpeed } from "./I2cBus.js";
import { I2CControlPanel } from "./I2CControlPanel.js";
import { ScanPanel } from "./ScanPanel.js";
import { I2CConsole, type BusActions } from "./I2CConsole.js";
import { type Row } from "./TelemetryView.js";

// The MCP2221's default USB identity (composite device: the I2C bridge is
// the vendor-defined HID interface; the CDC serial interface is its UART).
const MICROCHIP_VENDOR_ID = 0x04d8;
const MCP2221_PRODUCT_ID = 0x00dd;

const ARRIVAL_SETTLE_MS = 500; // opening mid-enumeration throws InvalidStateError

type Session = Device<Mcp2221Bridge, Mcp2221Status>;

// Everything MCP2221-specific about the console page.
export class Mcp2221Profile implements DeviceProfile<Mcp2221Bridge, Mcp2221Status> {
  public readonly productPrefix = "MCP2221";
  public readonly deviceName = "MCP2221";
  public readonly apiName = "WebHID";

  public supported = (): boolean => !!navigator.hid;

  public grantedDevices = async (): Promise<Mcp2221Bridge[]> =>
    (await navigator.hid.getDevices()).filter(Mcp2221Profile.isMcp2221).map(Mcp2221Bridge.fromDevice);

  public requestDevice = async (): Promise<Mcp2221Bridge | null> => {
    try {
      const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: MICROCHIP_VENDOR_ID, productId: MCP2221_PRODUCT_ID }],
      });
      return devices[0] ? Mcp2221Bridge.fromDevice(devices[0]) : null;
    } catch {
      return null; // picker cancelled
    }
  };

  // A stuck chip gets rebooted during connect and re-enumerates on USB;
  // hand it back to the session when it returns.
  public watchForArrival = (onArrival: (driver: Mcp2221Bridge) => void): void => {
    navigator.hid.addEventListener("connect", async (event) => {
      if (!Mcp2221Profile.isMcp2221(event.device)) return;
      await new Promise((resolve) => setTimeout(resolve, ARRIVAL_SETTLE_MS));
      onArrival(Mcp2221Bridge.fromDevice(event.device));
    });
  };

  public telemetryRows = (status: Mcp2221Status): Row[] => [
    ["Product", status.product],
    ["Revision", `hw ${status.hardwareRevision} / fw ${status.firmwareRevision}`],
    ["Speed", `${status.speedKhz} kHz`],
    ["SCL / SDA", `${status.scl ? 1 : 0} / ${status.sda ? 1 : 0}${status.busFree ? " (bus free)" : ""}`],
    ["Transfer", `${status.transferredBytes} / ${status.requestedBytes} bytes`],
    ["Read pending", status.readPending],
  ];

  public buildPanels = (root: ParentNode, session: Session): Panel<Mcp2221Status>[] => [
    this.buildControlPanel(root, session),
    this.buildScanPanel(root, session),
    this.buildConsole(root, session),
  ];

  private buildControlPanel = (root: ParentNode, session: Session): I2CControlPanel<Mcp2221Status> =>
    new I2CControlPanel(
      Dom.element(root, ".speed"),
      Dom.element(root, ".reset"),
      {
        toggleSpeed: () => {
          const next: I2cSpeed = session.lastStatus && session.lastStatus.speedKhz >= 400 ? 100 : 400;
          return session.command((bridge) => bridge.configure(next));
        },
        resetBus: () =>
          session.command(async (bridge) => {
            await bridge.cancel();
            session.statusLine.show("Transfer cancelled — bus freed");
          }),
      },
      (status) => `Speed: ${status.speedKhz} kHz`,
    );

  private buildScanPanel = (root: ParentNode, session: Session): ScanPanel =>
    new ScanPanel(Dom.element(root, ".scan"), Dom.element(root, ".scan-results"), () =>
      session.command((bridge) => bridge.scan()),
    );

  private buildConsole = (root: ParentNode, session: Session): I2CConsole => {
    const elements = {
      device: Dom.element<HTMLInputElement>(root, ".device"),
      payload: Dom.element<HTMLInputElement>(root, ".payload"),
      count: Dom.element<HTMLInputElement>(root, ".count"),
      writeButton: Dom.element<HTMLButtonElement>(root, ".write"),
      readButton: Dom.element<HTMLButtonElement>(root, ".read"),
      writeReadButton: Dom.element<HTMLButtonElement>(root, ".write-read"),
      log: Dom.element<HTMLOListElement>(root, ".transfer-log"),
    };
    return new I2CConsole(elements, this.busActions(session), session.statusLine);
  };

  private busActions = (session: Session): BusActions => ({
    write: async (device, bytes) =>
      (await session.command((bridge) => bridge.write(device, bytes).then(() => true))) ?? false,
    read: (device, count) => session.command((bridge) => bridge.read(device, count)),
    writeRead: (device, bytes, count) =>
      session.command((bridge) => bridge.writeRead(device, bytes, count)),
  });

  private static isMcp2221 = (device: HIDDevice): boolean =>
    device.vendorId === MICROCHIP_VENDOR_ID && device.productId === MCP2221_PRODUCT_ID;
}
