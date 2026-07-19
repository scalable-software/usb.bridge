# Software Architecture Requirements

## USB Bridge Framework for SPI and I²C Devices

**Version:** 1.0

## 1. Overview

This document defines the software architecture for a browser-based framework that communicates with external hardware devices through USB bridge adapters.

The primary design goals are:

* Separation of concerns
* Extensibility
* Protocol independence
* Bridge independence
* High testability
* Dependency injection throughout the architecture

The framework must support multiple USB bridge implementations while presenting a consistent API to device drivers.

Initially the framework will support:

* SPI
* I²C

Future serial buses should be supported without requiring changes to existing device drivers.

---

# 2. Architectural Layers

The architecture consists of five logical layers.

```text
Application
      │
      ▼
Device Driver
      │
      ▼
Bus Interface
      │
      ▼
Bridge Implementation
      │
      ▼
Host Transport
      │
      ▼
USB Device
```

Each layer has a single responsibility.

---

# 3. Layer Responsibilities

## 3.1 Application Layer

The application is responsible for:

* Creating objects
* Dependency injection
* User interface
* Business logic

The application must never communicate directly with USB devices.

Example:

```text
const transport = new WebSerialTransport();

const bridge = new SpiDriverBridge(transport);

const sensor = new TemperatureSensorDriver(bridge);

const value = await sensor.readTemperature();
```

---

## 3.2 Device Driver Layer

A device driver represents one physical device.

Examples include:

* Temperature sensor
* Pressure sensor
* EEPROM
* ADC
* DAC
* Motor controller
* GPIO expander

The driver exposes a high-level API.

Example:

```text
readTemperature()

setTargetVelocity()

readRegister()

writeConfiguration()

reset()

calibrate()
```

The driver **must not** know:

* USB
* HID
* Web Serial
* FTDI
* MCP2210
* USB packets

The driver only knows the bus interface.

---

# 4. Bus Layer

The bus layer represents the communication protocol used to communicate with a device.

Examples:

* SPI
* I²C

A driver depends only on the appropriate bus interface.

Example:

```text
TemperatureSensorDriver
            │
            ▼
        SpiBus
```

or

```text
TemperatureSensorDriver
            │
            ▼
        I2cBus
```

The driver should not know which bridge implementation is being used.

---

# 5. Bridge Layer

A bridge converts a USB communication channel into a hardware bus.

Examples:

* MCP2210
* SPIDriver
* FT232H
* Custom bridge firmware

Each bridge implementation hides chipset-specific command formats.

The bridge is responsible for:

* Creating chipset-specific command packets
* Parsing chipset-specific responses
* Configuring bridge hardware
* Error handling
* Bridge initialization
* Bus timing configuration

The bridge presents a common bus API.

Example:

```text
class Mcp2210SpiBridge
        implements SpiBus
```

```text
class SpiDriverBridge
        implements SpiBus
```

Both expose identical methods while internally using completely different command formats.

---

# 6. Host Transport Layer

The transport layer is responsible only for communication between the browser and the USB bridge.

Examples:

* Web Serial
* WebHID
* WebUSB

Responsibilities:

* Open connection
* Close connection
* Read bytes
* Write bytes
* Handle connection state
* Handle browser API interaction

The transport **must not** know anything about:

* SPI
* I²C
* Registers
* Commands
* Sensors
* Device drivers

Its responsibility is simply moving bytes.

Example:

```text
WebSerialTransport

WebHidTransport

WebUsbTransport
```

---

# 7. Dependency Injection

Dependencies are injected in one direction only.

```text
Transport
      │
      ▼
Bridge
      │
      ▼
Device Driver
      │
      ▼
Application
```

The dependency chain is:

```text
Application

creates

↓

Transport

injects into

↓

Bridge

injects into

↓

Device Driver
```

No lower layer should depend on a higher layer.

---

# 8. Interface Definitions

## HostTransport

Responsibilities:

* connect()
* disconnect()
* write()
* read()

No knowledge of SPI or I²C.

---

## SpiBus

Responsibilities:

* configure()
* select()
* deselect()
* transfer()
* write()
* read()

No knowledge of device registers.

---

## I2cBus

Responsibilities:

* configure()
* read()
* write()
* writeRead()
* scan()

No knowledge of device registers.

---

## Device Driver

Responsibilities:

* Device initialization
* Register access
* Device commands
* Status interpretation
* High-level operations

---

# 9. Why This Architecture?

This architecture allows changing any layer independently.

Example 1

Replace:

```text
MCP2210
```

with

```text
SPIDriver
```

Only the bridge implementation changes.

The sensor driver remains unchanged.

---

Example 2

Replace

```text
WebHID
```

with

```text
WebSerial
```

Only the transport changes.

Everything else remains unchanged.

---

Example 3

Replace

```text
Temperature Sensor
```

with

```text
EEPROM
```

Only the device driver changes.

---

# 10. Advantages

## Separation of concerns

Each class performs one job.

---

## Dependency inversion

Higher-level code depends on interfaces rather than concrete implementations.

---

## Testability

Each layer can be mocked independently.

Examples:

* Mock transport
* Mock bridge
* Mock SPI bus
* Mock device

---

## Extensibility

Future bridge chipsets can be added without changing existing drivers.

Future protocols can be added without changing transports.

---

## Reusability

One bridge implementation can support many device drivers.

One transport implementation can support many bridge implementations.

---

# 11. Example Object Graph

```text
Application
│
├── WebSerialTransport
│
└── SpiDriverBridge
      │
      ├── TemperatureSensorDriver
      │
      ├── EEPROMDriver
      │
      ├── MotorControllerDriver
      │
      └── ADCDriver
```

The same bridge instance may be shared by multiple device drivers.

---

# 12. Example Call Flow

```text
Application

↓

temperature.readTemperature()

↓

TemperatureSensorDriver

↓

spiBus.transfer(...)

↓

SpiDriverBridge

↓

WebSerialTransport.write(...)

↓

USB Bridge

↓

SPI Device
```

The response follows the reverse path back to the application.

---

# 13. Design Principles

The implementation shall follow these principles:

* Single Responsibility Principle (SRP)
* Dependency Injection (DI)
* Interface-based design
* Composition over inheritance
* Bridge independence
* Protocol independence
* Browser API isolation
* Strong TypeScript typing
* High unit-test coverage

---

# 14. Future Extensions

The architecture should support future additions such as:

* UART bus support
* CAN bus support
* 1-Wire devices
* Multiple bridge chipsets
* Multiple USB transports
* Logging and diagnostics
* Timing diagram integration
* Protocol analyzers
* Transaction recording and playback

These additions should require minimal or no changes to existing implementations.

---

# 15. Conclusion

The proposed architecture cleanly separates USB communication, bridge-specific behaviour, bus protocols, and device-specific logic into independent layers.

By injecting the **Host Transport** into the **Bridge**, and the **Bridge (via a Bus interface)** into each **Device Driver**, the framework remains highly modular, testable, and extensible. This design allows new transports, bridge chipsets, buses, and devices to be added independently while preserving a stable API for application code.
