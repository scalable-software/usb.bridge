# Bridge Hardware Reference

## SPIDriver board vs MCP2210 chip

**Version:** 1.0

This document records what the two SPI bridge devices actually are at the
chip level, and the fundamental differences that shape their bridge
implementations. The architecture ([Software_Requirements.md](Software_Requirements.md))
hides these differences above the Bridge layer; this document is for anyone
working *inside* that layer.

---

## 1. Board or chip? Getting the abstraction level right

The two devices sit at different levels of integration, so casual naming is
misleading:

| Name we use | What it actually is |
|---|---|
| "SPIDriver" | A **product** by Excamera Labs. There is no SPIDriver chip. |
| "MCP2210" | A **chip** by Microchip. The board around it (mikroE USB SPI Click) is passive breakout. |

### The SPIDriver board contains two chips

```text
USB ──► FTDI FT230X ──UART──► Silicon Labs EFM8 ──► SPI + A/B + screen
        (USB-serial only)     (8051-class MCU,
                               Excamera firmware)
```

* **FTDI FT230X** — a fixed-function USB-to-UART bridge. It knows nothing
  about SPI; it moves a 460,800-baud byte stream. This is why the board
  enumerates as an FTDI serial port (VID 0x0403, PID 0x6015) and why the
  browser reaches it through **Web Serial**.
* **Silicon Labs EFM8** (automotive grade) — a microcontroller whose
  firmware implements everything else: the single-byte command protocol,
  the SPI master, the A/B auxiliary outputs, the status record
  (voltage/current/temperature/CRC — the temperature sensor is on the EFM8
  die itself), and the live traffic display.

The SPI engine is therefore **firmware-defined**: its capabilities are
whatever Excamera programmed, and the protocol is theirs.

### The MCP2210 is the bridge

```text
USB ──► MCP2210 ──► SPI + GP0-GP8
        (fixed-function USB HID to SPI bridge)
```

A single fixed-function chip: USB HID device on one side (VID 0x04D8,
PID 0x00DE, reached through **WebHID**), SPI master plus nine GP pins on
the other. Its capabilities are defined by silicon and documented in the
Microchip datasheet; there is no firmware to update.

---

## 2. The fundamental differences

| | SPIDriver (EFM8 firmware) | MCP2210 (fixed silicon) |
|---|---|---|
| USB class | CDC serial via FT230X | HID |
| Browser transport | Web Serial | WebHID |
| Framing | Free byte stream | 64-byte reports, 1 command : 1 response |
| **SPI clock** | **Fixed ≈500 kHz** (spec 495–505 kbps) | **Configurable ~1.5 kbps – 12 MHz** (Set SPI Settings 0x40) |
| SPI modes | 0–3 (SPIDriver 2, 2021+ firmware) | 0–3 |
| **Chip select** | **Explicit software commands** (`s`/`u`); caller frames transactions | **Hardware-framed**: engine asserts CS, clocks exactly `bytesPerTransaction` bytes, releases CS |
| Auxiliary outputs | Two dedicated lines A and B (`a`/`b` commands) | Nine GP pins, each designatable as GPIO / CS / dedicated function |
| Telemetry | Voltage, current, temperature, uptime, traffic CRC | Chip/SPI settings, bus ownership, password status (no analog telemetry) |
| Throughput bottleneck | The 460,800-baud serial link | HID round-trips (60 data bytes per report + engine polling) |
| Multi-master | `x` command tri-states the outputs | Reports "bus unavailable" when an external master owns the bus |

### Why the clock difference exists

The SPIDriver's ~500 kHz SCK is a firmware ceiling, and raising it would
buy little: the FT230X link caps sustained throughput at ~46 KB/s anyway.
The MCP2210 clocks SPI directly from its 12 MHz core in silicon, so the
bit rate is a divisor setting — but its throughput is usually dominated by
HID transaction overhead, not SCK.

### Why the CS difference matters most

This is the one difference that leaks into driver design. A device driver
cannot say "assert CS, then do three writes" on the MCP2210 — CS framing
*is* the transaction there. Our `MicroOled` driver therefore depends on an
`OledWriter` ("one CS-framed, write-only transaction") rather than on
explicit select/deselect:

* [SpiProfile.ts](src/SpiProfile.ts) adapts the SPIDriver: `select()` →
  `write()` → `deselect()` per call.
* [Mcp2210Profile.ts](src/Mcp2210Profile.ts) adapts the MCP2210: one
  `transfer()` per call, readback discarded.

### Auxiliary lines

Both boards can drive a display's D/C and RST lines, differently:

* SPIDriver: dedicated A and B outputs, one command each.
* MCP2210: any GP pin designated as a GPIO output
  (`Mcp2210Config.gpioOutputs`), driven through the 9-bit pin-value word
  (commands 0x30/0x31).

---

## 3. Practical notes for this bench

* Micro OLED (SSD1306) maximum SPI clock is **10 MHz**; on the MCP2210 the
  highest safe divisor is **6 MHz**. The SPIDriver's fixed 500 kHz is
  always within spec.
* MCP2210 bit rate for the OLED is set in `OLED_WIRING` in
  [Mcp2210Profile.ts](src/Mcp2210Profile.ts).
* The SPIDriver's CRC and current telemetry make link verification
  observable from software; the MCP2210 offers no equivalent — verifying a
  write-only device there needs eyes on the hardware (or the SSD1306's
  0xA5 "all pixels on" command, which bypasses data writes entirely).

## Sources

* SPIDriver User Guide (Sept 2021) — [Datasheets/spidriver.pdf](Datasheets/spidriver.pdf)
  (§7.5 AC characteristics: SPI speed 495/500/505 kbps; §7.3 EFM8; §7.1 FT230X)
* [SPIDriver raw protocol](https://github.com/jamesbowman/spidriver/blob/master/protocol.md)
* Microchip MCP2210 datasheet (DS22288A) — commands 0x30/0x31/0x40/0x42
