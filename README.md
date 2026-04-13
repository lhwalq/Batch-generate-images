# Gemini Batch Image Generator

Chrome Manifest V3 extension for `https://gemini.google.com/app`.

## What it does

- Shows a floating panel only on Gemini App pages.
- Accepts your JSON payload and lets you specify one or more keys / paths.
- Extracts content strictly in the key order you enter.
- Supports values that are:
  - strings
  - arrays of strings
  - objects containing `prompt`, `prompt_en`, `text`, or `content`
- Sends prompts to Gemini one by one.
- Waits for a newly generated image to appear.
- For each prompt, waits for one newly generated image, then triggers Gemini page download via `Download full size`.
- Lets you append an aspect-ratio suffix to the end of each prompt:
  - preset ratios like `--ar 1:1`, `--ar 3:4`, `--ar 16:9`
  - custom text such as `--ar 2:3`
- If no ratio preset or custom text is set, nothing is appended.
- Renames each downloaded file automatically based on task order and prompt text.
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
3. Enter one or more keys / paths, separated by commas or new lines
4. Optionally choose a ratio preset or enter a custom suffix
5. Click `解析任务`
6. Adjust wait time if Gemini is slow
7. Click `开始批量同步`

Example key paths:

```text
main_image_prompts
thumbnail_prompt
data.prompts.0
```

## Notes

- Gemini page structure may change, so selectors are written to be flexible but may still need updates later.
- The current download logic processes one prompt at a time and downloads one fresh result before moving to the next prompt.
- If Gemini takes longer to render, increase the wait time in the panel.
