export class Dom {
  public static element = <T extends HTMLElement>(root: ParentNode, selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  };
}
