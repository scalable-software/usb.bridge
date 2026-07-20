import type { Transport, Filter, Handler } from "./Transport.js";
import { Events } from "./Transport.js";

export class HID implements Transport<HIDDevice> {
  private static toHidFilter = ({vendor, product}: Filter): HIDDeviceFilter => ({
    vendorId: vendor,
    productId: product,
  });

  private _onconnect: EventListener | null = null;
  private _ondisconnect: EventListener | null = null;

  private get api(): typeof navigator.hid {
    return navigator.hid;
  }

  public set onconnect(handler: Handler<HIDDevice> | null) {
    this._onconnect && this.api.removeEventListener(Events.CONNECT, this._onconnect);
    this._onconnect = handler && ((event) => handler((event as HIDConnectionEvent).device));
    this._onconnect && this.api.addEventListener(Events.CONNECT, this._onconnect);
  }

  public set ondisconnect(handler: Handler<HIDDevice> | null) {
    this._ondisconnect && this.api.removeEventListener(Events.DISCONNECT, this._ondisconnect);
    this._ondisconnect = handler && ((event) => handler((event as HIDConnectionEvent).device));
    this._ondisconnect && this.api.addEventListener(Events.DISCONNECT, this._ondisconnect);
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
