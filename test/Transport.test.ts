import { describe, it, expect } from "vitest";
import { Events } from "../src/Transport.js";

describe("Transport", () => {
  it("names the DOM events both APIs share", () => {
    expect(Events.CONNECT).toBe("connect");
    expect(Events.DISCONNECT).toBe("disconnect");
  });
});
