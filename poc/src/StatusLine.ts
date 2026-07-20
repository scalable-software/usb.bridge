export class StatusLine {
  private element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  public show = (text: string): void => {
    this.element.textContent = text;
  };
}
