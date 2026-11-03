export interface AudioDecoder {
  decodeFile(sourcePath: string, sampleRate: number): Promise<Float32Array>;
  /** Writes an 8k mono WAV, first cutting `trim` seconds of silence from either end when given. */
  convertFile(sourcePath: string, targetPath: string, trim?: { head: number; tail: number }): Promise<void>;
  dispose(): void;
}
