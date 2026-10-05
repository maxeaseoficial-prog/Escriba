// Browser libraries and model weights, NOT paid inference endpoints.
// Pin versions. To self-host, replace these URLs and MODEL_HOST with local paths,
// copy the complete runtime (including ONNX .mjs/.wasm), and update CSP in vercel.json.
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const PDF_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
export const MODEL_HOST = 'https://huggingface.co/';
export const MODELS = Object.freeze({ tiny: 'Xenova/whisper-tiny', base: 'Xenova/whisper-base', small: 'Xenova/whisper-small' });
