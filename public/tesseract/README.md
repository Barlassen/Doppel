The English, German and French models are gzip-compressed files from the Apache-2.0 `tessdata_fast` 4.1.0 release (commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`). They total 3.42 MB and are checked in so installation and recognition never need a separate model download.

`npm ci` copies the pinned Tesseract.js worker and its three LSTM WASM variants from `node_modules` into `runtime/`. The browser requests a single variant based on SIMD support.
