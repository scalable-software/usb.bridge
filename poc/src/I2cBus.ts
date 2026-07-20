export type I2cSpeed = 100 | 400;

// Bus layer: the I2C protocol as seen by device drivers and applications.
// No knowledge of device registers or of which bridge implements it.
export interface I2cBus {
  // Bus clock in kHz.
  configure(speed: I2cSpeed): Promise<void>;
  // Complete transactions (START ... STOP); device is the 7-bit address.
  read(device: number, count: number): Promise<Uint8Array>;
  write(device: number, bytes: ArrayLike<number>): Promise<void>;
  // Write then read joined by a repeated START.
  writeRead(device: number, bytes: ArrayLike<number>, count: number): Promise<Uint8Array>;
  // Probe the address range; returns the 7-bit addresses that ACKed.
  scan(): Promise<number[]>;
}
