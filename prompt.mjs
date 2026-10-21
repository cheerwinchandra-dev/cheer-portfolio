// Tiny terminal helper shared by the scripts.
import { createInterface } from 'node:readline';

let pipedLines = null;
async function readPiped() {
  if (pipedLines) return pipedLines;
  const rl = createInterface({ input: process.stdin });
  pipedLines = [];
  for await (const line of rl) pipedLines.push(line);
  return pipedLines;
}

/** Asks a question without echoing what you type (for passwords). */
export async function askHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    process.stdout.write(question + '\n');
    return (await readPiped()).shift() ?? '';
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += c;
      }
    };
    stdin.on('data', onData);
  });
}
