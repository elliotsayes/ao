export const DEFAULT_MODULE_FORMAT_TAG = { name: 'Module-Format', value: 'emscripten' }
export const DEFAULT_INPUT_ENCODING_TAG = { name: 'Input-Encoding', value: 'JSON-1' }
export const DEFAULT_OUTPUT_ENCODING_TAG = { name: 'Output-Encoding', value: 'JSON-1' }

export const DEFAULT_BUNDLER_HOST = 'https://node2.irys.xyz'

export const AoModuleTags = [
  { name: 'Data-Protocol', value: 'ao' },
  { name: 'Type', value: 'Module' },
  DEFAULT_MODULE_FORMAT_TAG,
  DEFAULT_INPUT_ENCODING_TAG,
  DEFAULT_OUTPUT_ENCODING_TAG,
  { name: 'Content-Type', value: 'application/wasm' }
]
