import { Dom } from "./Dom.js";
import { FTDI_VENDOR_ID } from "./Ftdi.js";
import type { Device, DeviceProfile, Panel } from "./Device.js";
import { I2cDriverBridge } from "./I2cDriverBridge.js";
import type { I2cSpeed } from "./I2cBus.js";
import type { I2cDriverStatus } from "./I2cDriverStatus.js";
import { I2CControlPanel } from "./I2CControlPanel.js";
import { ScanPanel } from "./ScanPanel.js";
import { I2CConsole, type BusActions } from "./I2CConsole.js";
import { TelemetryView, type Row } from "./TelemetryView.js";

type Session = Device<I2cDriverBridge, I2cDriverStatus>;

// Everything I2CDriver-specific about the console page.
export class I2CProfile implements DeviceProfile<I2cDriverBridge, I2cDriverStatus> {
  public readonly productPrefix = "i2cdriver";
  public readonly deviceName = "I2CDriver";
  public readonly apiName = "Web Serial";

  public supported = (): boolean => !!navigator.serial;

  public grantedDevices = async (): Promise<I2cDriverBridge[]> =>
    (await navigator.serial.getPorts()).map(I2cDriverBridge.fromPort);

  public requestDevice = async (): Promise<I2cDriverBridge | null> => {
    try {
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: FTDI_VENDOR_ID }] });
      return I2cDriverBridge.fromPort(port);
    } catch {
      return null; // picker cancelled
    }
  };

  public telemetryRows = (status: I2cDriverStatus): Row[] => [
    ["Product", status.product],
    ["Serial", status.serial],
    ["Voltage", `${status.voltage.toFixed(3)} V`],
    ["Current", `${status.current} mA`],
    ["Temperature", `${status.temperature.toFixed(1)} °C`],
    ["Uptime", TelemetryView.formatUptime(status.uptime)],
    ["Mode", status.mode],
    ["SDA / SCL", `${status.sda ? 1 : 0} / ${status.scl ? 1 : 0}${status.busFree ? " (bus free)" : ""}`],
    ["Speed", `${status.speed} kHz`],
    ["Pull-ups", `SDA ${status.sdaPullup} / SCL ${status.sclPullup}`],
    ["CRC", status.crc],
  ];

  public buildPanels = (root: ParentNode, session: Session): Panel<I2cDriverStatus>[] => [
    this.buildControlPanel(root, session),
    this.buildScanPanel(root, session),
    this.buildConsole(root, session),
  ];

  private buildControlPanel = (root: ParentNode, session: Session): I2CControlPanel<I2cDriverStatus> =>
    new I2CControlPanel(
      Dom.element(root, ".speed"),
      Dom.element(root, ".reset"),
      {
        toggleSpeed: () => {
          const next: I2cSpeed = session.lastStatus?.speed === 100 ? 400 : 100;
          return session.command((bridge) => bridge.configure(next));
        },
        resetBus: () =>
          session.command(async (bridge) => {
            const free = await bridge.reset();
            session.statusLine.show(
              free ? "Bus reset — SDA and SCL are high (free)" : "Bus reset attempted, but the bus is still held low",
            );
          }),
      },
      (status) => `Speed: ${status.speed} kHz`,
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
}
