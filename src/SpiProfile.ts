import { Dom } from "./Dom.js";
import { FTDI_VENDOR_ID } from "./Ftdi.js";
import type { Device, DeviceProfile, Panel } from "./Device.js";
import { SpiDriverBridge } from "./SpiDriverBridge.js";
import type { SpiDriverStatus } from "./SpiDriverStatus.js";
import { ControlPanel } from "./ControlPanel.js";
import { TransferConsole } from "./TransferConsole.js";
import { MicroOled } from "./MicroOled.js";
import { OledPanel } from "./OledPanel.js";
import { ClockPanel } from "./ClockPanel.js";
import { TelemetryView, type Row } from "./TelemetryView.js";

type Session = Device<SpiDriverBridge, SpiDriverStatus>;

// Everything SPIDriver-specific about the console page.
export class SpiProfile implements DeviceProfile<SpiDriverBridge, SpiDriverStatus> {
  public readonly productPrefix = "spidriver";
  public readonly deviceName = "SPIDriver";
  public readonly apiName = "Web Serial";

  public supported = (): boolean => !!navigator.serial;

  public grantedDevices = async (): Promise<SpiDriverBridge[]> =>
    (await navigator.serial.getPorts()).map(SpiDriverBridge.fromPort);

  public requestDevice = async (): Promise<SpiDriverBridge | null> => {
    try {
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: FTDI_VENDOR_ID }] });
      return SpiDriverBridge.fromPort(port);
    } catch {
      return null; // picker cancelled
    }
  };

  public telemetryRows = (status: SpiDriverStatus): Row[] => {
    const rows: Row[] = [
      ["Product", status.product],
      ["Serial", status.serial],
      ["Voltage", `${status.voltage.toFixed(3)} V`],
      ["Current", `${status.current} mA`],
      ["Temperature", `${status.temperature.toFixed(1)} °C`],
      ["Uptime", TelemetryView.formatUptime(status.uptime)],
      ["CRC", status.crc],
    ];
    if (status.mode !== null) {
      rows.push(["SPI mode", status.mode]);
    }
    return rows;
  };

  public buildPanels = (root: ParentNode, session: Session): Panel<SpiDriverStatus>[] => [
    this.buildControlPanel(root, session),
    this.buildTransferConsole(root, session),
    this.buildOledPanel(root, session),
    new ClockPanel(
      Dom.element<HTMLButtonElement>(root, ".oled-clock"),
      this.oledRunner(session),
      session.statusLine,
    ),
  ];

  private buildControlPanel = (root: ParentNode, session: Session): ControlPanel => {
    const buttons = {
      cs: Dom.element<HTMLButtonElement>(root, ".cs"),
      a: Dom.element<HTMLButtonElement>(root, ".a"),
      b: Dom.element<HTMLButtonElement>(root, ".b"),
      detach: Dom.element<HTMLButtonElement>(root, ".detach"),
    };
    return new ControlPanel(buttons, {
      toggleChipSelect: () =>
        session.command((bridge) =>
          session.lastStatus?.selected ? bridge.deselect() : bridge.select(),
        ),
      toggleA: () => session.command((bridge) => bridge.setA(!session.lastStatus?.a)),
      toggleB: () => session.command((bridge) => bridge.setB(!session.lastStatus?.b)),
      detachBus: () =>
        session.command(async (bridge) => {
          await bridge.detach();
          session.statusLine.show("SPI bus released (pins tri-stated) — any command re-engages it");
        }),
    });
  };

  private buildTransferConsole = (root: ParentNode, session: Session): TransferConsole => {
    const elements = {
      input: Dom.element<HTMLInputElement>(root, ".payload"),
      button: Dom.element<HTMLButtonElement>(root, ".transfer"),
      log: Dom.element<HTMLOListElement>(root, ".transfer-log"),
    };
    return new TransferConsole(elements, (bytes) => this.transaction(session, bytes), session.statusLine);
  };

  private buildOledPanel = (root: ParentNode, session: Session): OledPanel => {
    const buttons = {
      init: Dom.element<HTMLButtonElement>(root, ".oled-init"),
      checker: Dom.element<HTMLButtonElement>(root, ".oled-checker"),
      border: Dom.element<HTMLButtonElement>(root, ".oled-border"),
      invert: Dom.element<HTMLButtonElement>(root, ".oled-invert"),
      clear: Dom.element<HTMLButtonElement>(root, ".oled-clear"),
    };
    return new OledPanel(buttons, this.oledRunner(session), session.statusLine);
  };

  private oledRunner =
    (session: Session) =>
    <T>(task: (oled: MicroOled) => Promise<T>): Promise<T | null> =>
      session.command((bridge) => task(SpiProfile.oledOn(bridge)));

  // The demo board wires the SPIDriver's auxiliary outputs to the display's
  // control pins: A drives D/C, B drives RST. The SPIDriver has explicit
  // chip select, so each display write is framed in select/deselect here.
  private static oledOn = (bridge: SpiDriverBridge): MicroOled =>
    new MicroOled(
      async (bytes) => {
        await bridge.select();
        try {
          await bridge.write(bytes);
        } finally {
          await bridge.deselect();
        }
      },
      { dataCommand: bridge.setA, reset: bridge.setB },
    );

  // A CS-framed transaction expressed through the SpiBus contract.
  private transaction = (session: Session, bytes: number[]): Promise<Uint8Array | null> =>
    session.command(async (bridge) => {
      await bridge.select();
      try {
        return await bridge.transfer(bytes);
      } finally {
        await bridge.deselect();
      }
    });
}
