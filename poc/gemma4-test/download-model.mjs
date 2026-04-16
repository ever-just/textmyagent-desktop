/**
 * Download Gemma 4 E4B GGUF from the official ggml-org repository.
 *
 * Source: https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF
 * (ggml-org is the official GGUF conversion maintained by the llama.cpp team,
 *  from Google's official google/gemma-4-E4B-it weights)
 *
 * This uses node-llama-cpp's built-in model downloader which supports:
 * - Resume on interruption
 * - Progress reporting
 * - Automatic file verification
 */

import path from "path";
import { fileURLToPath } from "url";
import { createModelDownloader } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, "models");

// Official ggml-org GGUF — Q4_K_M quantization (~5 GB)
const MODEL_URI = "hf:ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M";

console.log("=== Gemma 4 E4B Model Downloader ===");
console.log(`Source: ${MODEL_URI}`);
console.log(`Destination: ${modelsDir}`);
console.log("");

const downloader = await createModelDownloader({
  modelUri: MODEL_URI,
  dirPath: modelsDir,
  onProgress: (status) => {
    const pct = Math.round((status.downloadedSize / status.totalSize) * 100);
    const downloadedMB = (status.downloadedSize / 1024 / 1024).toFixed(1);
    const totalMB = (status.totalSize / 1024 / 1024).toFixed(1);
    process.stdout.write(`\rDownloading: ${pct}% (${downloadedMB} MB / ${totalMB} MB)`);
  },
});

console.log(`\nModel file: ${downloader.entrypointFilename}`);
console.log(`Total size: ${(downloader.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
console.log("\nStarting download (this will take a while for ~5 GB)...\n");

const modelPath = await downloader.download();

console.log(`\n\nDownload complete!`);
console.log(`Model saved to: ${modelPath}`);
