export class HexCodec {
  public static encode = (bytes: ArrayLike<number>): string =>
    Array.from(bytes, (byte) => HexCodec.encodeByte(byte)).join(" ");

  public static decode = (text: string): number[] =>
    HexCodec.tokenize(text).map((token) => HexCodec.decodeByte(token));

  private static encodeByte = (byte: number): string =>
    byte.toString(16).padStart(2, "0").toUpperCase();

  private static tokenize = (text: string): string[] =>
    text.trim().split(/[\s,]+/).filter(Boolean);

  private static decodeByte = (token: string): number => {
    const value = Number.parseInt(token.replace(/^0x/i, ""), 16);
    if (Number.isNaN(value) || value < 0 || value > 0xff) {
      throw new Error(`"${token}" is not a hex byte`);
    }
    return value;
  };
}
