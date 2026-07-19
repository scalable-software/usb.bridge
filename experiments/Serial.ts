import type { Transport, Filter, Handler } from "./Transport.js";
import { Events } from "./Transport.js";


export class Serial implements Transport<SerialPort> {
  private static toSerialFilter = ({vendor, product}: Filter): SerialPortFilter => ({
    usbVendorId: vendor,
    usbProductId: product,
  });

  private connectListener: EventListener | null = null;
  private disconnectListener: EventListener | null = null;

  private get api(): typeof navigator.serial {
    return navigator.serial;
  }

  public set onconnect(handler: Handler<SerialPort> | null) {
    this.connectListener && this.api.removeEventListener(Events.CONNECT, this.connectListener);
    this.connectListener = handler && ((event) => handler(event.target as SerialPort));
    this.connectListener && this.api.addEventListener(Events.CONNECT, this.connectListener);
  }

  public set ondisconnect(handler: Handler<SerialPort> | null) {
    this.disconnectListener && this.api.removeEventListener(Events.DISCONNECT, this.disconnectListener);
    this.disconnectListener = handler && ((event) => handler(event.target as SerialPort));
    this.disconnectListener && this.api.addEventListener(Events.DISCONNECT, this.disconnectListener);
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
