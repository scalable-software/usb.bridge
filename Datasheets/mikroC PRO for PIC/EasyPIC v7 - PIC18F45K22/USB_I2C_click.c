/*
 * Project name:
      USB I2C click
 * Copyright:
      (c) mikroElektronika, 2015.
 * Revision History:
      20151002:
      - Initial release (BN);
 * Description:
      This is demonstration project how USB I2C click can be used to control
      slave microcontroller via I2C. USB I2C click carries Microchip's MCP2221
      chip. Click is designed to be used with 3.3V or 5V power supply.
      Example had implemented these functions:
       - Writing bytes for first LCD line
       - Writing bytes for second LCD line
       - Start the Buzzer Song (Beethoven, Ludwig Van - Fur Elise)
       - Control PORTD pins.
 * Test configuration:
     MCU:             PIC18F45K22
                      http://ww1.microchip.com/downloads/en/DeviceDoc/41412F.pdf
     Dev. Board:      EasyPIC v7
                      http://www.mikroe.com/easypic/
     Oscillator:      HS-PLL, 8.000 MHz Crystal, 32.000 MHz MCU Clock
     Ext. Modules:    USB I2C click
                      http://www.mikroe.com/click/usb-i2c
     SW:              mikroC PRO for PIC
                      http://www.mikroe.com/mikroc/pic/

 * NOTES:
      - Place USB I2C click board in the mikroBUS socket 1.
      - Turn ON LCD backlight SW4.6
      - Turn ON PORTD LEDs
      - Place jumper to RE1 position at J21

*/

//Constants
#define S_LCD1 1
#define S_LCD2 2
#define S_BUZZ 3
#define S_PORT 4

#define eNote 220   // Duration of Eighth Note in ms
#define qNote 440   // Duration of Quater Note in ms


// LCD pinout settings
sbit LCD_RS at LATB4_bit;
sbit LCD_EN at LATB5_bit;
sbit LCD_D7 at LATB3_bit;
sbit LCD_D6 at LATB2_bit;
sbit LCD_D5 at LATB1_bit;
sbit LCD_D4 at LATB0_bit;

// Pin direction
sbit LCD_RS_Direction at TRISB4_bit;
sbit LCD_EN_Direction at TRISB5_bit;
sbit LCD_D7_Direction at TRISB3_bit;
sbit LCD_D6_Direction at TRISB2_bit;
sbit LCD_D5_Direction at TRISB1_bit;
sbit LCD_D4_Direction at TRISB0_bit;
//End of LCD pinout settings


char r_address;
char LCDline1[17] = {0};
char LCDline2[17] = {0};
char port_val;

short c1Dat = 0;
short c2Dat = 0;
int   flag  = 0;

void Interrupt_high() iv 0x0008 ics ICS_AUTO {
char tmp;
  if(SSP1IF_bit){                               // Check for I2C Slave interrupt
    SSP1IF_bit = 0;                             // Clear the I2C Interrupt Flag
    if (P_SSP1STAT_bit){                        // When Stop bit is detected
      switch (r_address){      // setup flag variable according to command received in address
        case S_LCD1:
          flag = S_LCD1;
        break;
        case S_LCD2:
          flag = S_LCD2;
        break;
        case S_BUZZ:
          flag = S_BUZZ;
        break;
        case S_PORT:
          flag = S_PORT;
        break;
      }
      return;
    }
    tmp = SSP1BUF;                               // Read the buffer of MSSP module
    if (D_NOT_A_SSP1STAT_bit){
      if (r_address == S_LCD1)
      {
        LCDline1[c1Dat++] = tmp;
        LCDline1[c1Dat] = 0;
        if (c1Dat > 16){               // prevents oversteping the RAM variables
          c1Dat = 0;
        }
      }
      if(r_address == S_LCD2)
      {
        LCDline2[c2Dat++] = tmp;
        LCDline2[c2Dat] = 0;
        if (c2Dat > 16){               // prevents oversteping the RAM variables
          c2Dat = 0;
        }
      }
      if (r_address == S_PORT){
        port_val = tmp;         // Read PORT byte sent by PC
      }
    }
    else{                       // Received byte is address byte
      r_address   = tmp;        // Extract the command from address
      r_address  &= 0x0F;       // Apply mask
      r_address >>= 1;          // Shift back the W/R bit to get command
    }
    CKP_SSP1CON1_bit = 1;       // Release the I2C clock
  }
}


//This function defines the notes
void PlayNote(char note, unsigned short octave, int duration){
int f_Hz;
float fact;
  if (octave > 8)
  {
    octave = 8;
  }
  switch(note){                               // Note        Frequency (Hz)
    case 'c':
      fact = 16.35 * pow(2, octave);          // C0          16.35
    break;
    case 'C':
      fact = 17.32 * pow(2, octave);          // C#0/Db0     17.32
    break;
    case 'd':
      fact = 18.35 * pow(2, octave);          // D0          18.35
    break;
    case 'D':
      fact = 19.45 * pow(2, octave);          // D#0/Eb0     19.45
    break;
    case 'e':
      fact = 20.60 * pow(2, octave);          // E0          20.60
    break;
    case 'f':
      fact = 21.83 * pow(2, octave);          // F0          21.83
    break;
    case 'F':
      fact = 23.12 * pow(2, octave);          // F#0/Gb0     23.12
    break;
    case 'g':
      fact = 24.50 * pow(2, octave);          // G0          24.50
    break;
    case 'G':
      fact = 25.96 * pow(2, octave);          // G#0/Ab0     25.96
    break;
    case 'a':
      fact = 27.50 * pow(2, octave);          // A0          27.50
    break;
    case 'A':
      fact = 29.14 * pow(2, octave);          // A#0/Bb0     29.14
    break;
    case 'b':
      fact = 30.87 * pow(2, octave);          // B0          30.87
    break;
    default:
      fact = 0;
    break;
  }
  f_Hz = (int) fact;
  Sound_Play(f_Hz, duration);
}

//Music
void PlayFurElise(){
  PlayNote('e', 5, eNote);
  PlayNote('D', 5, eNote);
  //
  PlayNote('e', 5, eNote);
  PlayNote('D', 5, eNote);
  PlayNote('e', 5, eNote);
  PlayNote('b', 4, eNote);
  PlayNote('d', 5, eNote);
  PlayNote('c', 5, eNote);
  //
  PlayNote('a', 4, qNote);
  PlayNote('a', 3, eNote);
  PlayNote('c', 4, eNote);
  PlayNote('e', 4, eNote);
  PlayNote('a', 4, eNote);
  //
  PlayNote('b', 4, qNote);
  PlayNote('b', 3, eNote);
  PlayNote('e', 4, eNote);
  PlayNote('G', 4, eNote);
  PlayNote('b', 4, eNote);
  //
  PlayNote('c', 5, qNote);
  PlayNote('a', 3, eNote);
  PlayNote('e', 4, eNote);
  PlayNote('e', 5, eNote);
  PlayNote('D', 5, eNote);
  //
  PlayNote('e', 5, eNote);
  PlayNote('D', 5, eNote);
  PlayNote('e', 5, eNote);
  PlayNote('b', 4, eNote);
  PlayNote('d', 5, eNote);
  PlayNote('c', 5, eNote);
  //
  PlayNote('a', 4, qNote);
  PlayNote('a', 3, eNote);
  PlayNote('c', 4, eNote);
  PlayNote('e', 4, eNote);
  PlayNote('a', 4, eNote);
  //
  PlayNote('b', 4, qNote);
  PlayNote('b', 3, eNote);
  PlayNote('e', 4, eNote);
  PlayNote('c', 5, eNote);
  PlayNote('b', 4, eNote);
  //
  PlayNote('a', 4, 660);
}

//Alert
void LCDAlert(){
  Sound_Play(440, 25);
  Sound_Play(660, 25);
}

void PORTAlert(){
  PlayNote('c', 4, 20);
  PlayNote('c', 5, 35);
  PlayNote('c', 6, 20);
  PlayNote('c', 7, 20);
}

void main() {
  ANSELA = 0;                        // Configure pins as digial
  ANSELB = 0;                        //
  ANSELC = 0;                        //
  ANSELD = 0;                        //
  ANSELE = 0;                        //
  LATD   = 0;                        // Reset LATD register
  TRISD  = 0;                        // Configure PORTD pins as digital

  SSP1IF_bit = 0;                    // Reset I2C Interrupt flag
  SSP1IP_bit = 1;                    // MSSP1 Interrupt Priority (High priority)
  PEIE_bit   = 1;                    // Peripheral Interrupt Enable
  SSP1IE_bit = 1;                    // MSSP1 Interrupt Enable
  GIE_bit    = 1;                    // Global Interrupt Enable
  TRISC3_bit = 1;                    // Configure I2C SCL pin
  TRISC4_bit = 1;                    // Configure I2C SDA pin
  SSP1MSK  = 0xF0;                   // Define Mask for address 

  SSP1ADD  = 0xE0;                   // Define Address of IC2 Slave
  SSP1CON1 = 0x36;                   // Configure I2C in Slave mode
  PCIE_SSP1CON3_bit = 1;             // Enable I2C STOP bit Interrupt
  SEN_SSP1CON2_bit  = 1;             // Clock Stretching is enabled

  Sound_Init(&PORTE, 1);             // Initialize Buzzer Sound
  Lcd_Init();                        // Initialize LCD

  Lcd_Cmd(_LCD_CLEAR);               // Clear display
  Lcd_Cmd(_LCD_CURSOR_OFF);          // Cursor off
  Lcd_Out(1, 2, "USB I2C click");       // Initial message on LCD
  Lcd_Out(2, 5, "Example");             //

  while(1){
    switch (flag){
      case S_LCD1:                   // First LCD line bytes are received
        Lcd_Cmd(_LCD_CLEAR);         // Clear first line
        Lcd_Out(1, 1, LCDline1);     // Write received data
        c1Dat = 0;                   // Reset buffer
        LCDline1[0] = 0;             //
        flag = 0;                    // Reset flag variable
        LCDAlert();                  // Sound efect
      break;
      case S_LCD2:
        Lcd_Out(2, 1, LCDline2);     // Clear second line
        LCDline2[0] = 0;             // Reset buffer
        c2Dat = 0;                   //
        flag = 0;                    // Reset flag variable
        LCDAlert();
      break;
      case S_BUZZ:
        PlayFurElise();
        flag = 0;                    // Reset flag variable
      break;
      case S_PORT:
        LATD = port_val;
        PORTAlert();
        flag = 0;                    // Reset flag variable
      break;
    }
  }
}