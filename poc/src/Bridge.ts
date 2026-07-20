// The minimum a bridge's status must reveal about the connected hardware,
// so the session can verify and announce it.
export interface DeviceIdentity {
  product: string;
  serial?: string;
}

// What the application layer needs from any bridge, regardless of chipset:
// lifecycle, a proven link, telemetry, and unplug notification.
export interface Bridge<S> {
  open(): Promise<void>;
  close(): Promise<void>;
  // Prove the link end-to-end before trusting it (may self-heal first).
  verifyLink(): Promise<void>;
  status(): Promise<S>;
  onDisconnect(handler: () => void): void;
}
