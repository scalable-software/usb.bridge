import { Dom } from "./Dom.js";
import type { Device, DeviceProfile, Panel } from "./Device.js";
import { Mcp2210Bridge, type Mcp2210Config } from "./Mcp2210Bridge.js";
import type { Mcp2210Status } from "./Mcp2210Status.js";
import { TransferConsole } from "./TransferConsole.js";
import { MicroOled } from "./MicroOled.js";
import { OledPanel } from "./OledPanel.js";
import { ClockPanel } from "./ClockPanel.js";
import { type Row } from "./TelemetryView.js";

// The MCP2210's default USB identity.
const MICROCHIP_VENDOR_ID = 0x04d8;
const MCP2210_PRODUCT_ID = 0x00de;

// The Micro OLED demo wiring on this bench: CS on GP0 (hardware-framed by
// the SPI engine), RST on GP1, D/C on GP2.
const RST_PIN = 1;
const DC_PIN = 2;
const OLED_WIRING: Mcp2210Config = {
  csPin: 0,
  bitRate: 1_000_000,
  spiMode: 0,
  gpioOutputs: [RST_PIN, DC_PIN],
};

type Session = Device<Mcp2210Bridge, Mcp2210Status>;

// Everything MCP2210-specific about the console page.
export class Mcp2210Profile implements DeviceProfile<Mcp2210Bridge, Mcp2210Status> {
  public readonly productPrefix = "MCP2210";
  public readonly deviceName = "MCP2210";
  public readonly apiName = "WebHID";

  public supported = (): boolean => !!navigator.hid;

  public grantedDevices = async (): Promise<Mcp2210Bridge[]> =>
    (await navigator.hid.getDevices())
      .filter(Mcp2210Profile.isMcp2210)
      .map((device) => Mcp2210Bridge.fromDevice(device, OLED_WIRING));

  public requestDevice = async (): Promise<Mcp2210Bridge | null> => {
    try {
      const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: MICROCHIP_VENDOR_ID, productId: MCP2210_PRODUCT_ID }],
      });
      return devices[0] ? Mcp2210Bridge.fromDevice(devices[0], OLED_WIRING) : null;
    } catch {
      return null; // picker cancelled
    }
  };

  public telemetryRows = (status: Mcp2210Status): Row[] => [
    ["Product", status.product],
    ["Bus owner", status.busOwner],
    ["Bus release", status.busReleaseRequested ? "requested by external master" : "no request pending"],
    ["Bit rate", `${(status.bitRate / 1000).toFixed(0)} kHz`],
    ["SPI mode", status.spiMode],
    ["Bytes / transaction", status.bytesPerTransaction],
    [`CS pin (GP${OLED_WIRING.csPin})`, status.csPinDesignated ? "chip select" : "not designated!"],
    ["CS idle / active", `0x${status.idleCs.toString(16)} / 0x${status.activeCs.toString(16)}`],
    ["Password attempts", `${status.passwordAttempts}${status.passwordGuessed ? " (guessed)" : ""}`],
  ];

  public buildPanels = (root: ParentNode, session: Session): Panel<Mcp2210Status>[] => [
    this.buildTransferConsole(root, session),
    this.buildOledPanel(root, session),
    new ClockPanel(
      Dom.element<HTMLButtonElement>(root, ".oled-clock"),
      this.oledRunner(session),
      session.statusLine,
    ),
  ];

  private buildTransferConsole = (root: ParentNode, session: Session): TransferConsole => {
    const elements = {
      input: Dom.element<HTMLInputElement>(root, ".payload"),
      button: Dom.element<HTMLButtonElement>(root, ".transfer"),
      log: Dom.element<HTMLOListElement>(root, ".transfer-log"),
    };
    return new TransferConsole(
      elements,
      (bytes) => session.command((bridge) => bridge.transfer(bytes)),
      session.statusLine,
    );
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
      session.command((bridge) => task(Mcp2210Profile.oledOn(bridge)));

  // The MCP2210 frames chip select in hardware around each transfer, so a
  // display write is a plain transfer whose input bytes are discarded; the
  // D/C and RST lines are GPIO outputs.
  private static oledOn = (bridge: Mcp2210Bridge): MicroOled =>
    new MicroOled(
      async (bytes) => {
        await bridge.transfer(bytes);
      },
      {
        dataCommand: (data) => bridge.setGpio(DC_PIN, data),
        reset: (level) => bridge.setGpio(RST_PIN, level),
      },
    );

  private static isMcp2210 = (device: HIDDevice): boolean =>
    device.vendorId === MICROCHIP_VENDOR_ID && device.productId === MCP2210_PRODUCT_ID;
}
