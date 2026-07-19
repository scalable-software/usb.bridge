const STORAGE_KEY = "visible-boards";

// The "which boards do I have?" chooser: each checkbox shows or hides one
// console section, and the choice is remembered across visits.
export class BoardPicker {
  private toggles: HTMLInputElement[];

  constructor(root: ParentNode) {
    this.toggles = [...root.querySelectorAll<HTMLInputElement>("input[data-board]")];
    const remembered = this.remembered();
    for (const toggle of this.toggles) {
      if (remembered) toggle.checked = remembered.includes(toggle.dataset.board ?? "");
      toggle.addEventListener("change", () => this.apply());
    }
    this.apply();
  }

  private apply = (): void => {
    for (const toggle of this.toggles) {
      const section = document.getElementById(toggle.dataset.board ?? "");
      if (section) section.hidden = !toggle.checked;
    }
    this.remember();
  };

  private remembered = (): string[] | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  private remember = (): void => {
    const visible = this.toggles.filter((t) => t.checked).map((t) => t.dataset.board);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
    } catch {
      // private browsing: selection simply won't persist
    }
  };
}
