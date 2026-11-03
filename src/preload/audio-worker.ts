import { ipcRenderer, type IpcRendererEvent } from "electron";

interface DecodeRequest {
  id: number;
  bytes: Uint8Array;
  sampleRate: number;
}

function describeDecodeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "EncodingError") {
    return "文件内容无法识别为音频，可能已损坏或格式不受支持";
  }
  return error instanceof Error ? error.message : String(error);
}

async function decodeToMono(bytes: Uint8Array, sampleRate: number): Promise<Float32Array> {
  const encoded = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const decoded = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(encoded);
  if (decoded.length === 0) throw new Error("音频时长为 0");
  const mixer = new OfflineAudioContext(1, decoded.length, sampleRate);
  const source = mixer.createBufferSource();
  source.buffer = decoded;
  source.connect(mixer.destination);
  source.start();
  const rendered = await mixer.startRendering();
  return rendered.getChannelData(0);
}

ipcRenderer.on("audio-worker:decode", (_event: IpcRendererEvent, request: DecodeRequest) => {
  decodeToMono(request.bytes, request.sampleRate)
    .then((samples) => ipcRenderer.send("audio-worker:result", { id: request.id, samples }))
    .catch((error: unknown) => ipcRenderer.send("audio-worker:result", { id: request.id, error: describeDecodeError(error) }));
});

ipcRenderer.send("audio-worker:ready");
