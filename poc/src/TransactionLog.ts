// Newest-first monospace log of bus transactions.
export class TransactionLog {
  private list: HTMLOListElement;

  constructor(list: HTMLOListElement) {
    this.list = list;
  }

  public append = (text: string): void => {
    const entry = document.createElement("li");
    entry.textContent = text;
    this.list.prepend(entry);
  };

  public clear = (): void => this.list.replaceChildren();
}
