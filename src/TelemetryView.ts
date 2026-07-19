export type Row = [label: string, value: string | number];

// Renders label/value rows into a <dl>; each device supplies its own rows.
export class TelemetryView<S> {
  private list: HTMLDListElement;
  private rowsFor: (status: S) => Row[];

  constructor(list: HTMLDListElement, rowsFor: (status: S) => Row[]) {
    this.list = list;
    this.rowsFor = rowsFor;
  }

  public render = (status: S): void =>
    this.list.replaceChildren(...this.rowsFor(status).flatMap(([label, value]) => this.row(label, value)));

  public clear = (): void => this.list.replaceChildren();

  public static formatUptime = (seconds: number): string => {
    const hour = Math.floor(seconds / 3600);
    const minute = Math.floor((seconds % 3600) / 60);

    return `${hour}:${String(minute).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };

  private row = (label: string, value: string | number): [HTMLElement, HTMLElement] => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value);
    return [term, detail];
  };
}
