# Gemini Batch Image Generator

Chrome Manifest V3 extension for `https://gemini.google.com/app`.

## What it does

- Shows a floating panel only on Gemini App pages.
- Accepts your JSON payload and extracts all `prompt_en` values from:
  - `main_image_prompts`
  - `thumbnail_prompt` (optional)
- Sends prompts to Gemini one by one.
- Waits for a newly generated image to appear.
- For each prompt, waits for one newly generated image, then triggers Gemini page download via `Download full size`.
- Renames each downloaded file automatically based on:
  - `id`
  - `usage`
- Default wait time is `60` seconds per cycle.

Example filename:

```text
gemini-batch/gemini-batch/01_1_开场钩子.png
```

## Install

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select this folder

## Usage

1. Open `https://gemini.google.com/app`
2. Paste JSON into the floating panel
3. Click `解析 JSON`
4. Adjust wait time if Gemini is slow
5. Click `开始批量`

## Notes

- Gemini page structure may change, so selectors are written to be flexible but may still need updates later.
- The current download logic processes one prompt at a time and downloads one fresh result before moving to the next prompt.
- If Gemini takes longer to render, increase the wait time in the panel.
