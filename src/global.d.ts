declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'heic-convert' {
  function convert(opts: {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer>;
  export default convert;
}
