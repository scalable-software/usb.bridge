import { Dom } from "./Dom.js";
import type { Device, DeviceProfile, Panel } from "./Device.js";
import { Mcp2210Bridge } from "./Mcp2210Bridge.js";
import type { Mcp2210Status } from "./Mcp2210Status.js";
import { TransferConsole } from "./TransferConsole.js";
import { type Row } from "./TelemetryView.js";

// The MCP2210's default USB identity.
const MICROCHIP_VENDOR_ID = 0x04d8;
const MCP2210_PRODUCT_ID = 0x00de;

type Session = Device<Mcp2210Bridge, Mcp2210Status>;

// Everything MCP2210-specific about the console page.
export class Mcp2210Profile implements DeviceProfile<Mcp2210Bridge, Mcp2210Status> {
  public readonly productPrefix = "MCP2210";
  public readonly deviceName = "MCP2210";
  public readonly apiName = "WebHID";

  public supported = (): boolean => !!navigator.hid;

  public grantedDevices = async (): Promise<Mcp2210Bridge[]> =>
    (await navigator.hid.getDevices()).filter(Mcp2210Profile.isMcp2210).map(Mcp2210Bridge.fromDevice);

  public requestDevice = async (): Promise<Mcp2210Bridge | null> => {
    try {
      const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: MICROCHIP_VENDOR_ID, productId: MCP2210_PRODUCT_ID }],
      });
      return devices[0] ? Mcp2210Bridge.fromDevice(devices[0]) : null;
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
    ["CS pin (GP4)", status.csPinDesignated ? "chip select" : "not designated!"],
    ["CS idle / active", `0x${status.idleCs.toString(16)} / 0x${status.activeCs.toString(16)}`],
    ["Password attempts", `${status.passwordAttempts}${status.passwordGuessed ? " (guessed)" : ""}`],
  ];

  public buildPanels = (root: ParentNode, session: Session): Panel<Mcp2210Status>[] => [
    this.buildTransferConsole(root, session),
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

  private static isMcp2210 = (device: HIDDevice): boolean =>
    device.vendorId === MICROCHIP_VENDOR_ID && device.productId === MCP2210_PRODUCT_ID;
}
