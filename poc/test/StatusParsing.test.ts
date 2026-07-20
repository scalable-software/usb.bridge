import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpiDriverStatus } from "../dist/SpiDriverStatus.js";
import { I2cDriverStatus } from "../dist/I2cDriverStatus.js";

describe("SpiDriverStatus", () => {
  // Captured from spidriver1 hardware with CS asserted (selected):
  // the flag order on the wire is A, B, CS — NOT the CS, A, B the guide documents.
  const SELECTED = "[spidriver1 DO01HCRB 000000534 5.138 000 32.5 1 1 0 ffff                       ]";

  it("parses the record fields", () => {
    const status = SpiDriverStatus.parse(SELECTED);
    assert.equal(status.product, "spidriver1");
    assert.equal(status.serial, "DO01HCRB");
    assert.equal(status.uptime, 534);
    assert.equal(status.voltage, 5.138);
    assert.equal(status.current, 0);
    assert.equal(status.temperature, 32.5);
    assert.equal(status.crc, "ffff");
    assert.equal(status.mode, null); // spidriver1 has no mode token
  });

  it("reads the flags in hardware order A, B, CS", () => {
    const status = SpiDriverStatus.parse(SELECTED);
    assert.equal(status.a, true);
    assert.equal(status.b, true);
    assert.equal(status.cs, false); // CS low
    assert.equal(status.selected, true); // active low
  });

  it("parses the spidriver2 mode token when present", () => {
    const status = SpiDriverStatus.parse("[spidriver2 DO000000 000000001 5.0 000 25.0 1 1 1 abcd 2 ]");
    assert.equal(status.mode, 2);
  });

  it("rejects malformed records", () => {
    assert.throws(() => SpiDriverStatus.parse("[garbage]"), /Malformed status record/);
  });
});

describe("I2cDriverStatus", () => {
  // Captured from i2cdriver1 hardware at boot defaults.
  const IDLE = "[i2cdriver1 DO01JHF1 000000439 5.053 000 34.0 I 1 1 100 24 ffff                ]";

  it("parses the record fields", () => {
    const status = I2cDriverStatus.parse(IDLE);
    assert.equal(status.product, "i2cdriver1");
    assert.equal(status.serial, "DO01JHF1");
    assert.equal(status.uptime, 439);
    assert.equal(status.mode, "I2C");
    assert.equal(status.sda, true);
    assert.equal(status.scl, true);
    assert.equal(status.busFree, true);
    assert.equal(status.speed, 100);
    assert.equal(status.crc, "ffff");
  });

  it("decodes the pullup byte (0x24 = both 4.7K, the boot default)", () => {
    const status = I2cDriverStatus.parse(IDLE);
    assert.equal(status.pullups, 0x24);
    assert.equal(status.sdaPullup, "4.7K");
    assert.equal(status.sclPullup, "4.7K");
  });

  it("recognises bitbang mode and a held bus", () => {
    const status = I2cDriverStatus.parse("[i2cdriver1 DO01JHF1 000000001 5.0 000 25.0 B 0 1 400 07 abcd ]");
    assert.equal(status.mode, "bitbang");
    assert.equal(status.busFree, false);
    assert.equal(status.speed, 400);
    assert.equal(status.sdaPullup, "1.1K");
  });

  it("rejects malformed records", () => {
    assert.throws(() => I2cDriverStatus.parse("[spidriver1 X 1 5.0 0 25.0 1 1 1 ffff]"), /Malformed status record/);
  });
});
