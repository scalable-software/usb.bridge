export class StatusPoller {
  private task: () => void;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(task: () => void, intervalMs: number) {
    this.task = task;
    this.intervalMs = intervalMs;
  }

  public start = (): void => {
    this.stop();
    this.timer = setInterval(this.task, this.intervalMs);
  };

  public stop = (): void => {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  };
}
