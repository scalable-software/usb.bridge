/*
 * Project name:
      USB SPI click (Example)
 * Copyright:
     (c) MikroElektronika, 2012
 * Revision History:
     20120809:
       - initial release (JK);
 * Description:
     This is a sample program which demonstrates the use of the Microchip's
     MCP2210 USB-to-SPI Protocol Converter with GPIO (Master Mode). 
     http://ww1.microchip.com/downloads/en/DeviceDoc/22288A.pdf
     This device accepts commands from SPI Terminal and sends appropriate
     bytes via SPI interface. It is very desirable tool for designing SPI
     slave devices such as sensors...
     
     This example shows how a microcontroller-based device which acts as SPI slave
     can be controlled via USB SPI click board. User should put commands into 
     the SPI Terminal application and control PORTB/PORTD outputs and PORTA 
     analog inputs.
 * Test configuration:
     MCU:             PIC18F45K22
                      http://ww1.microchip.com/downloads/en/DeviceDoc/41412D.pdf
     Dev.Board:       EasyPIC7
                      http://www.mikroe.com/eng/products/view/757/easypic-v7-development-system/
     Oscillator:      HS-PLL, 32.00000 MHz
     ext. modules:    USB SPI click : ac:USB_SPI_click
                      http://www.mikroe.com/eng/products/view/962/usb-spi-click/
     SW:              mikroC PRO for PIC
                      http://www.mikroe.com/eng/products/view/7/mikroc-pro-for-pic/
                      MCP2210 Utility
                      http://www.microchip.com/downloads/en/DeviceDoc/MCP2210Utility.zip
                      MCP2210 DLL v1.1
                      http://ww1.microchip.com/downloads/en/DeviceDoc/MCP2210_DLL_v1.1.zip
                      MCP2210 SPI Terminal v1.0
                      http://ww1.microchip.com/downloads/en/DeviceDoc/MCP2210_SpiTerminal-v1.0.zip
 * NOTES:
     - Place USB SPI click board into mikroBUS socket1.
     - Place Juper1 into 3.3V position.
     - Turn on PortB and D LEDs (SW3.2, 3.4)
     - Place J15 in appropriate position (select desired channel)
     - USB SPI click board should be controlled with SPI Terminal application.
       Application should be configured as shown on the picture.
       ac:SPI_Terminal_Settings
     - Chip Select is used on GPIO4 pin (RC0)
     - Each command is consisted of two bytes: first one defines which action
       will be executed, and second byte carries the action parameter.
       
       Commands: 0A - read analog input
                 0x - desired channel (valid inputs 0, 1, 2, 3, 4)
                 
                 0B - set digital output on PortB
                 xx - desired value
                 
                 0D - set digital output on PortD
                 xx - desired value
 */

// DAC module connections
sbit Chip_Select           at    RC0_bit;
sbit Chip_Select_Direction at TRISC0_bit;
// End DAC module connections

unsigned short value;

const _ACK = 0x00;         // ACK constant
const _ERROR = 0x01;       // ERROR constant

char temp, sound_flag = 0, temp2;
char SMState;

// State Machine function
void StateMachine(){
  switch (SMState){
    case 0  : {
                if (temp == 0x0B)       // Write to PORTB
                  SMState = 10;
                if (temp == 0x0D)       // Write to PORTD
                  SMState = 20;
                if (temp == 0x0A)       // Read Analog input
                  SMState = 30;
              }; break;
    case 10 : {
                LATB = temp;            // Write
                SSP1BUF = _ACK;         // Send ACK on next SPI write
                sound_flag = 1;         // Schedule for sound signalization
                SMState = 0;            // Default
              }; break;
    case 20 : {
                LATD = temp;            // Write
                SSP1BUF = _ACK;         // Send ACK on next SPI write
                sound_flag = 1;         // Schedule for sound signalization
                SMState = 0;            // Default
              }; break;
    case 30 : {
                if ((temp >= 0) && (temp <= 4)) {      // Chose desired channel
                  SSP1BUF = ADC_Get_Sample(temp) >> 2;  // Send ADC value on next SPI Write cyclus
                  sound_flag = 1;       // Schedule for sound signalization
                }
                else
                  SSP1BUF = _ERROR;
                SMState = 0;            // Default
              }; break;
    default : SMState = 0; break;       // Default
  }
}

// Interrupt Service Routine
void SPI_Slave_ISR() iv 0x0008 ics ICS_AUTO {
  if (SSP1IF_bit){
    if (Chip_Select == 0){         // If proper chip select bit has been set to zero
      temp = SSP1BUF;              // Save received byte
      StateMachine();
    }
    SSP1IF_bit = 0;                // Reset apropriate interrupt flag
  }
}

// Main function
void main() {
  ANSELA = 0x2F;                   // Set A0, A1, A2, A3, A5 as analog inputs
  ANSELB = 0;                      // Set PORTB as digital
  ANSELC = 0;                      // Set PORTC as digital
  ANSELD = 0;                      // Set PORTD as digital
  SLRCON = 0;                      // Set output slew rate on all ports at standard rate

  ADC_Init();                      // Initialize ADC

  TRISA = 0xFF;                    // Set PortA as input
  TRISB = 0;                       // Set PortB as output
  TRISD = 0;                       // Set PortD as output
  Chip_Select_Direction = 1;       // Set chip selection as input
  
  Sound_init(&PORTC, 2);
  // SPI init
  SPI1_Init_Advanced(_SPI_SLAVE_SS_DIS,        // Initialize SPI module as slave
                     _SPI_DATA_SAMPLE_MIDDLE,
                     _SPI_CLK_IDLE_LOW, 
                     _SPI_LOW_2_HIGH);
                     
  TRISC3_bit = 1;                  // Set clock as input (Master drives clock)

  // interrupt init
  IPEN_bit = 0;                    // Disable priority levels
  SSP1IE_bit = 1;                  // Enable SPI1 interrupts
  GIE_bit = 1;                     // Enable Global interrupts
  PEIE_bit = 1;                    // Enable Peripheral interrupts
                                          
  while (1){                        // Endless loop
    if (sound_flag){
      Sound_Play(2000, 50);
      sound_flag = 0;
    }
  }
}