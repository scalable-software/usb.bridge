import { Dom } from "./Dom.js";
import { Device } from "./Device.js";
import { BoardPicker } from "./BoardPicker.js";
import { SpiProfile } from "./SpiProfile.js";
import { I2CProfile } from "./I2CProfile.js";
import { Mcp2210Profile } from "./Mcp2210Profile.js";
import { Mcp2221Profile } from "./Mcp2221Profile.js";

// Boot sequentially: the serial consoles scan the same granted ports at
// startup, and scanning one at a time keeps them from opening the same port
// at once. Hidden sections still connect, ready for when they are shown.
const boot = async (): Promise<void> => {
  new BoardPicker(document);
  await new Device(Dom.element(document, "#spi"), new SpiProfile()).start();
  await new Device(Dom.element(document, "#i2c"), new I2CProfile()).start();
  await new Device(Dom.element(document, "#mcp2210"), new Mcp2210Profile()).start();
  await new Device(Dom.element(document, "#mcp2221"), new Mcp2221Profile()).start();
};

boot();
