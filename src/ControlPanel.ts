import type { SpiDriverStatus } from "./SpiDriverStatus.js";

export interface ControlActions {
  toggleChipSelect(): void;
  toggleA(): void;
  toggleB(): void;
  detachBus(): void;
}

export interface ControlButtons {
  cs: HTMLButtonElement;
  a: HTMLButtonElement;
  b: HTMLButtonElement;
  detach: HTMLButtonElement;
}

// The three signal-line buttons: chip select and the A/B auxiliary outputs.
export class ControlPanel {
  private cs: HTMLButtonElement;
  private a: HTMLButtonElement;
  private b: HTMLButtonElement;
  private detach: HTMLButtonElement;

  constructor({ cs, a, b, detach }: ControlButtons, actions: ControlActions) {
    this.cs = cs;
    this.a = a;
    this.b = b;
    this.detach = detach;
    this.wire(actions);
  }

  public update = (status: SpiDriverStatus): void => {
    this.updateChipSelect(status);
    this.updateAuxiliary(status);
  };

  private wire = (actions: ControlActions): void => {
    this.cs.addEventListener("click", () => actions.toggleChipSelect());
    this.a.addEventListener("click", () => actions.toggleA());
    this.b.addEventListener("click", () => actions.toggleB());
    this.detach.addEventListener("click", () => actions.detachBus());
  };

  private updateChipSelect = (status: SpiDriverStatus): void => {
    this.cs.textContent = status.selected ? "CS: low (selected)" : "CS: high (idle)";
  };

  private updateAuxiliary = (status: SpiDriverStatus): void => {
    this.a.textContent = `A: ${status.a ? 1 : 0}`;
    this.b.textContent = `B: ${status.b ? 1 : 0}`;
  };
}
