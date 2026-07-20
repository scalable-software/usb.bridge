import { Dom } from "./Dom.js";
import { StatusLine } from "./StatusLine.js";
import { StatusPoller } from "./StatusPoller.js";
import { TelemetryView, type Row } from "./TelemetryView.js";
import type { Bridge, DeviceIdentity } from "./Bridge.js";

const POLL_INTERVAL_MS = 2000;

// A device-specific view: refreshed on every status poll, emptied on disconnect.
export interface Panel<S> {
  update?(status: S): void;
  clear?(): void;
}

// Everything device-specific the generic session needs — including discovery,
// because how devices are found (Web Serial ports, WebHID devices) is as
// chipset-specific as how they are spoken to.
export interface DeviceProfile<D extends Bridge<S>, S extends DeviceIdentity> {
  productPrefix: string;
  deviceName: string;
  apiName: string;
  supported(): boolean;
  // Bridges for every already-granted device that might be this board.
  grantedDevices(): Promise<D[]>;
  // Show the browser's picker (requires a user gesture); null if cancelled.
  requestDevice(): Promise<D | null>;
  telemetryRows(status: S): Row[];
  buildPanels(root: ParentNode, session: Device<D, S>): Panel<S>[];
  // Optional: notify when a matching device (re)appears on the host — e.g.
  // after a bridge chip reset that re-enumerates on USB.
  watchForArrival?(onArrival: (driver: D) => void): void;
}

// Application layer: owns the connection lifecycle of one console section.
// Knows no chipset specifics — anything device-flavored comes in through the
// profile. Several instances can share a page, each scoped to its own root.
export class Device<D extends Bridge<S>, S extends DeviceIdentity> {
  public readonly statusLine: StatusLine;
  private profile: DeviceProfile<D, S>;
  private driver: D | null = null;
  private latest: S | null = null;
  private connectButton: HTMLButtonElement;
  private disconnectButton: HTMLButtonElement;
  private controlsSection: HTMLElement;
  private telemetry: TelemetryView<S>;
  private panels: Panel<S>[];
  private poller: StatusPoller;

  constructor(root: ParentNode, profile: DeviceProfile<D, S>) {
    this.profile = profile;
    this.connectButton = Dom.element(root, ".connect");
    this.disconnectButton = Dom.element(root, ".disconnect");
    this.controlsSection = Dom.element(root, ".controls");
    this.statusLine = new StatusLine(Dom.element(root, ".status"));
    this.telemetry = new TelemetryView(Dom.element(root, ".telemetry"), profile.telemetryRows);
    this.panels = profile.buildPanels(root, this);
    this.poller = new StatusPoller(() => this.poll(), POLL_INTERVAL_MS);
  }

  public get lastStatus(): S | null {
    return this.latest;
  }

  // Resolves once the startup device scan settles, so a second console on the
  // same page can begin its own scan without racing this one for devices.
  public start = async (): Promise<void> => {
    if (!this.profile.supported()) {
      this.reportUnsupported();
      return;
    }
    this.wireConnectionButtons();
    this.profile.watchForArrival?.((driver) => {
      if (!this.driver) this.connect(driver);
    });
    await this.reconnectToGrantedDevice();
  };

  // Run a device command, then refresh so every view reflects the new state.
  public command = async <T>(action: (driver: D) => Promise<T>): Promise<T | null> => {
    if (!this.driver) return null;
    try {
      const result = await action(this.driver);
      await this.refresh();
      return result;
    } catch (error) {
      console.error(error);
      this.statusLine.show(`Command failed: ${Device.describe(error)}`);
      return null;
    }
  };

  private static describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  private reportUnsupported = (): void => {
    this.connectButton.disabled = true;
    this.statusLine.show(`${this.profile.apiName} is not available in this browser. Use Chrome or Edge on desktop.`);
  };

  private wireConnectionButtons = (): void => {
    this.connectButton.addEventListener("click", () => this.connectViaPicker());
    this.disconnectButton.addEventListener("click", () => this.disconnect());
  };

  // Try every granted device until one turns out to be the right board.
  private reconnectToGrantedDevice = async (): Promise<void> => {
    for (const driver of await this.profile.grantedDevices()) {
      if (await this.connect(driver)) return;
    }
    this.statusLine.show(`Click Connect and choose the ${this.profile.deviceName}`);
  };

  private connectViaPicker = async (): Promise<void> => {
    const driver = await this.profile.requestDevice();
    if (driver) await this.connect(driver);
  };

  private connect = async (driver: D): Promise<boolean> => {
    this.driver = driver;
    this.statusLine.show("Opening device…");
    try {
      await driver.open();
      await driver.verifyLink();
      await this.refresh();
      this.verifyProduct();
    } catch (error) {
      console.error(error);
      await this.abandonDriver();
      this.statusLine.show(`Connection failed: ${Device.describe(error)}`);
      return false;
    }
    driver.onDisconnect(() => {
      if (this.driver === driver) this.disconnect("Device unplugged");
    });
    this.showConnected();
    return true;
  };

  private verifyProduct = (): void => {
    const product = this.latest?.product ?? "unknown";
    if (!product.startsWith(this.profile.productPrefix)) {
      throw new Error(`Connected device reports "${product}", not a ${this.profile.deviceName}`);
    }
  };

  private showConnected = (): void => {
    if (this.latest) {
      const serial = this.latest.serial ? ` (serial ${this.latest.serial})` : "";
      this.statusLine.show(`Connected to ${this.latest.product}${serial}`);
    }
    this.connectButton.hidden = true;
    this.disconnectButton.hidden = false;
    this.controlsSection.hidden = false;
    this.poller.start();
  };

  private disconnect = async (message = "Disconnected"): Promise<void> => {
    this.poller.stop();
    await this.abandonDriver();
    this.latest = null;
    this.telemetry.clear();
    for (const panel of this.panels) panel.clear?.();
    this.showDisconnected(message);
  };

  private showDisconnected = (message: string): void => {
    this.connectButton.hidden = false;
    this.disconnectButton.hidden = true;
    this.controlsSection.hidden = true;
    this.statusLine.show(message);
  };

  private abandonDriver = async (): Promise<void> => {
    if (!this.driver) return;
    await this.driver.close().catch(() => {});
    this.driver = null;
  };

  private poll = async (): Promise<void> => {
    try {
      await this.refresh();
    } catch (error) {
      console.error("status poll failed", error);
      await this.disconnect(`Lost connection: ${Device.describe(error)}`);
    }
  };

  private refresh = async (): Promise<void> => {
    if (!this.driver) return;
    const status = await this.driver.status();
    this.latest = status;
    this.telemetry.render(status);
    for (const panel of this.panels) panel.update?.(status);
  };
}
