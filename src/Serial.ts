import type { Transport, Filter, Handler } from "./Transport.js";
import { Events } from "./Transport.js";


export class Serial implements Transport<SerialPort> {
  private static toSerialFilter = ({vendor, product}: Filter): SerialPortFilter => ({
    usbVendorId: vendor,
    usbProductId: product,
  });

  private _onconnect: EventListener | null = null;
  private _ondisconnect: EventListener | null = null;

  private get api(): typeof navigator.serial {
    return navigator.serial;
  }

  public set onconnect(handler: Handler<SerialPort> | null) {
    this._onconnect && this.api.removeEventListener(Events.CONNECT, this._onconnect);
    this._onconnect = handler && ((event) => handler(event.target as SerialPort));
    this._onconnect && this.api.addEventListener(Events.CONNECT, this._onconnect);
  }

  public set ondisconnect(handler: Handler<SerialPort> | null) {
    this._ondisconnect && this.api.removeEventListener(Events.DISCONNECT, this._ondisconnect);
    this._ondisconnect = handler && ((event) => handler(event.target as SerialPort));
    this._ondisconnect && this.api.addEventListener(Events.DISCONNECT, this._ondisconnect);
  }

  public supported = (): boolean => !!this.api;

  public requestPermission = async (filters: Filter[] = []): Promise<SerialPort | null> => {
    try {
      return await this.api.requestPort({
        filters: filters.map(Serial.toSerialFilter),
      });
    } catch {
      return null; // picker cancelled (or no user gesture)
    }
  };

  public granted = (): Promise<SerialPort[]> => this.api.getPorts();

  public forget = ({forget}: SerialPort): Promise<void> => forget();
}
