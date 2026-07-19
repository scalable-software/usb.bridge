// Bus layer: the SPI protocol as seen by device drivers and applications.
// No knowledge of device registers or of which bridge implements it.
export interface SpiBus {
  // SPI mode 0-3 (CPOL/CPHA).
  configure(mode: number): Promise<void>;
  select(): Promise<void>;
  deselect(): Promise<void>;
  // Full-duplex: clocks bytes out and returns the bytes clocked in.
  transfer(bytes: ArrayLike<number>): Promise<Uint8Array>;
  // Write-only: input data is discarded.
  write(bytes: ArrayLike<number>): Promise<void>;
  // Read-only: clocks out filler bytes.
  read(count: number): Promise<Uint8Array>;
}
