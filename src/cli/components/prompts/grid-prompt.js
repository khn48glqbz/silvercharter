import readline from "readline";
import chalk from "chalk";

function formatLabel(choice) {
  if (!choice) return "";
  if (typeof choice.short === "string") return choice.short;
  if (typeof choice.name === "string") return choice.name;
  return String(choice.value);
}

/**
 * gridPrompt(message, choices, options)
 * -------------------------------------
 * Lightweight helper to render a rectangular grid of options with arrow-key navigation.
 * Supports:
 *   - columns: number of columns to render.
 *   - columnWidth / columnWidths: default + per-column width overrides.
 *   - exitValue: value to return if the user presses ESC.
 */
export async function gridPrompt(message, choices, options = {}) {
  const columns = Math.max(1, options.columns || 3);
  const exitValue = options.exitValue ?? null;
  const labels = choices.map((choice) => formatLabel(choice));
  const defaultWidth = options.columnWidth || Math.min(50, Math.max(...labels.map((label) => label.length)) + 4);
  const columnWidthOptions = Array.isArray(options.columnWidths) ? options.columnWidths : [];
  const columnMaxLengths = new Array(columns).fill(0);
  labels.forEach((label, idx) => {
    const col = idx % columns;
    columnMaxLengths[col] = Math.max(columnMaxLengths[col], label.length);
  });
  const columnWidths = new Array(columns).fill(defaultWidth).map((_, idx) => {
    if (typeof columnWidthOptions[idx] === "number" && columnWidthOptions[idx] > 4) {
      return columnWidthOptions[idx];
    }
    return Math.max(columnMaxLengths[idx] + 2, defaultWidth);
  });
  const totalRows = Math.ceil(choices.length / columns);

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    readline.emitKeypressEvents(process.stdin, rl);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdout.write("\x1B[?1049h");
    let pointer = 0;
    let renderLines = 0;
    const hideCursor = () => process.stdout.write("\x1B[?25l");
    const showCursor = () => process.stdout.write("\x1B[?25h");

    const cleanup = (value) => {
      showCursor();
      process.stdout.write("\x1B[?1049l");
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      rl.close();
      process.stdout.write("\n");
      resolve(value);
    };

    const clearPrevious = () => {
      if (!renderLines) return;
      for (let i = 0; i < renderLines; i += 1) {
        process.stdout.write("\x1B[2K\r");
        if (i < renderLines - 1) process.stdout.write("\x1B[1A");
      }
      renderLines = 0;
    };

    const render = () => {
      hideCursor();
      process.stdout.write("\x1B[2J\x1B[0;0H");
      const lines = [];
      lines.push(message);
      lines.push("");
      for (let row = 0; row < totalRows; row += 1) {
        const cells = [];
        for (let col = 0; col < columns; col += 1) {
          const idx = row * columns + col;
          if (idx >= choices.length) break;
          const label = labels[idx];
          const width = columnWidths[col] || defaultWidth;
          const maxLen = Math.max(width - 1, 1);
          const truncated = label.length > maxLen ? `${label.slice(0, maxLen)}…` : label;
          const padded = truncated.padEnd(width, " ");
          cells.push(idx === pointer ? chalk.cyan.inverse(padded) : padded);
        }
        lines.push(cells.join(" "));
      }
      lines.push("");
      lines.push(chalk.dim("Use arrow keys to navigate. Enter to select. Esc to cancel."));
      const output = lines.join("\n");
      process.stdout.write(output);
      renderLines = lines.length;
    };

    const onKeypress = (str, key) => {
      if (!key) return;
      if (key.name === "return") {
        cleanup(choices[pointer].value);
        return;
      }
      if (key.name === "left") {
        if (pointer % columns > 0) pointer -= 1;
      } else if (key.name === "right") {
        if (pointer % columns < columns - 1 && pointer + 1 < choices.length) pointer += 1;
      } else if (key.name === "up") {
        if (pointer - columns >= 0) pointer -= columns;
      } else if (key.name === "down") {
        if (pointer + columns < choices.length) pointer += columns;
      } else if (key.name === "escape") {
        cleanup(exitValue);
        return;
      } else if (key.ctrl && key.name === "c") {
        showCursor();
        process.stdout.write("\x1B[?1049l");
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        process.stdout.write("\n");
        reject(new Error("Cancelled"));
        return;
      }
      render();
    };

    rl.input.on("keypress", onKeypress);
    render();
  });
}
