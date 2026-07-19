export const Events = {
  CONNECT: "connect",
  DISCONNECT: "disconnect",
} as const;

export type Filter = {
  vendor?: number;
  product?: number;
};

export type Handler<Handle> = (device: Handle) => void;

export type Transport<Handle> = {
  onconnect: Handler<Handle> | null;
  ondisconnect: Handler<Handle> | null;

  supported(): boolean;

  requestPermission(filters?: Filter[]): Promise<Handle | null>;

  granted(): Promise<Handle[]>;

  forget(device: Handle): Promise<void>;
};
