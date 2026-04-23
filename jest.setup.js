const { TextEncoder, TextDecoder } = require("util");
const { BroadcastChannel } = require("worker_threads");
const {
  ReadableStream,
  TransformStream,
  WritableStream,
} = require("stream/web");

globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.BroadcastChannel = BroadcastChannel;
globalThis.ReadableStream = ReadableStream;
globalThis.TransformStream = TransformStream;
globalThis.WritableStream = WritableStream;
