// Test doubles for the browser globals the Serial and HID wrappers reach
// through their `api` getter. Each fake models exactly the members those
// wrappers touch — getPorts/getDevices, requestPort/requestDevice, the
// add/removeEventListener pair — plus test hooks (emit, listenerCount) and
// a recorder for the options a picker was called with.

// A minimal event-listener registry shared by both fake APIs.
class Listeners {
  private map = new Map<string, Set<(event: unknown) => void>>();

  public add(type: string, fn: (event: unknown) => void): void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
  }

  public remove(type: string, fn: (event: unknown) => void): void {
    this.map.get(type)?.delete(fn);
  }

  public emit(type: string, event: unknown): void {
    for (const fn of [...(this.map.get(type) ?? [])]) fn(event);
  }

  public count(type: string): number {
    return this.map.get(type)?.size ?? 0;
  }
}

export type RequestOptions = { filters?: Array<Record<string, number | undefined>> };

export class FakePort {
  public forgotten = false;
  public forget(): Promise<void> {
    this.forgotten = true;
    return Promise.resolve();
  }
}

// Stands in for navigator.serial. requestPort resolves ONE port and rejects
// when cancelled — the real Web Serial contract.
export class FakeSerial {
  public ports: FakePort[] = [];
  public nextPort: FakePort = new FakePort();
  public rejectRequest = false;
  public lastOptions: RequestOptions | null = null;
  private listeners = new Listeners();

  public getPorts(): Promise<FakePort[]> {
    return Promise.resolve(this.ports);
  }

  public requestPort(options: RequestOptions): Promise<FakePort> {
    this.lastOptions = options;
    return this.rejectRequest
      ? Promise.reject(new Error("NotFoundError: picker cancelled"))
      : Promise.resolve(this.nextPort);
  }

  public addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.add(type, fn);
  }

  public removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.remove(type, fn);
  }

  // Test hooks.
  public emit(type: string, event: unknown): void {
    this.listeners.emit(type, event);
  }
  public listenerCount(type: string): number {
    return this.listeners.count(type);
  }
}

export class FakeDevice {
  public forgotten = false;
  public productName: string;
  constructor(productName = "Fake HID Device") {
    this.productName = productName;
  }
  public forget(): Promise<void> {
    this.forgotten = true;
    return Promise.resolve();
  }
}

// Stands in for navigator.hid. requestDevice resolves an ARRAY and returns
// an empty one when cancelled — the real WebHID contract.
export class FakeHid {
  public devices: FakeDevice[] = [];
  public nextDevices: FakeDevice[] = [new FakeDevice()];
  public rejectRequest = false;
  public lastOptions: RequestOptions | null = null;
  private listeners = new Listeners();

  public getDevices(): Promise<FakeDevice[]> {
    return Promise.resolve(this.devices);
  }

  public requestDevice(options: RequestOptions): Promise<FakeDevice[]> {
    this.lastOptions = options;
    return this.rejectRequest ? Promise.reject(new Error("boom")) : Promise.resolve(this.nextDevices);
  }

  public addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.add(type, fn);
  }

  public removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.remove(type, fn);
  }

  public emit(type: string, event: unknown): void {
    this.listeners.emit(type, event);
  }
  public listenerCount(type: string): number {
    return this.listeners.count(type);
  }
}

// Stub / replace the global navigator so the wrappers see our fakes. Node
// 22+ ships a read-only navigator; defineProperty replaces it wholesale, so
// omitting a key (e.g. no `serial`) simulates a browser lacking that API.
export const installNavigator = (parts: { serial?: unknown; hid?: unknown }): void => {
  Object.defineProperty(globalThis, "navigator", {
    value: parts,
    configurable: true,
    writable: true,
  });
};
