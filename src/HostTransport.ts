// Host Transport layer: moves bytes between the browser and a USB bridge.
// Implementations (Web Serial, WebHID, WebUSB, mocks) must know nothing
// about SPI, I2C, commands, or devices.
export interface HostTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  // Resolves with the next received chunk, or null once the stream ends.
  read(): Promise<Uint8Array | null>;
  // Invoked when the underlying device goes away (e.g. USB unplug).
  onDisconnect(handler: () => void): void;
}
