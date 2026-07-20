export interface I2CControlActions {
  toggleSpeed(): void;
  resetBus(): void;
}

// Bus-level controls for an I2C console: speed toggle and stuck-bus recovery.
// The speed label is injected because each bridge's status names it differently.
export class I2CControlPanel<S> {
  private speed: HTMLButtonElement;
  private reset: HTMLButtonElement;
  private speedLabel: (status: S) => string;

  constructor(
    speed: HTMLButtonElement,
    reset: HTMLButtonElement,
    actions: I2CControlActions,
    speedLabel: (status: S) => string,
  ) {
    this.speed = speed;
    this.reset = reset;
    this.speedLabel = speedLabel;
    this.wire(actions);
  }

  public update = (status: S): void => {
    this.speed.textContent = this.speedLabel(status);
  };

  private wire = (actions: I2CControlActions): void => {
    this.speed.addEventListener("click", () => actions.toggleSpeed());
    this.reset.addEventListener("click", () => actions.resetBus());
  };
}
