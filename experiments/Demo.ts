import type { Transport, Filter } from "./Transport.js";
import { Serial } from "./Serial.js";
import { HID } from "./HID.js";


const reconnectOrAsk = async <Handle>(
  api: Transport<Handle>,
  filter: Filter,
): Promise<Handle | null> => {
  if (!api.supported()) return null;
  const [alreadyGranted] = await api.granted();
  if (alreadyGranted) return alreadyGranted;
  return api.requestPermission([filter]); // needs a user gesture
};

export const demo = async (): Promise<void> => {
  const serial = new Serial();
  const hid = new HID();

  const spiDriver = await reconnectOrAsk(serial, { vendor: 0x0403 });
  const mcp2210 = await reconnectOrAsk(hid, { vendor: 0x04d8, product: 0x00de });

  console.log("SPIDriver:", spiDriver);
  console.log("MCP2210:", mcp2210);

  serial.ondisconnect = (port) => console.log("serial device unplugged", port);

  hid.ondisconnect = (device) => console.log("HID device unplugged", device.productName);
};
