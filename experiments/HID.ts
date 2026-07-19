import type { Transport, Filter, Handler } from "./Transport.js";
import { Events } from "./Transport.js";

export class HID implements Transport<HIDDevice> {
  private static toHidFilter = ({vendor, product}: Filter): HIDDeviceFilter => ({
    vendorId: vendor,
    productId: product,
  });

  private connectListener: EventListener | null = null;
  private disconnectListener: EventListener | null = null;

  private get api(): typeof navigator.hid {
    return navigator.hid;
  }

  public set onconnect(handler: Handler<HIDDevice> | null) {
    this.connectListener && this.api.removeEventListener(Events.CONNECT, this.connectListener);
    this.connectListener = handler && ((event) => handler((event as HIDConnectionEvent).device));
    this.connectListener && this.api.addEventListener(Events.CONNECT, this.connectListener);
  }

  public set ondisconnect(handler: Handler<HIDDevice> | null) {
    this.disconnectListener && this.api.removeEventListener(Events.DISCONNECT, this.disconnectListener);
    this.disconnectListener = handler && ((event) => handler((event as HIDConnectionEvent).device));
    this.disconnectListener && this.api.addEventListener(Events.DISCONNECT, this.disconnectListener);
  }

  public supported = (): boolean => !!this.api;

  public requestPermission = async (filters: Filter[] = []): Promise<HIDDevice | null> => {
    try {
      const devices = await this.api.requestDevice({
        filters: filters.map(HID.toHidFilter),
      });
      return devices[0] ?? null;
    } catch {
      return null; // e.g. called without a user gesture
    }
  };

  public granted = (): Promise<HIDDevice[]> => this.api.getDevices();

  public forget = ({forget}: HIDDevice): Promise<void> => forget();

}
