/** Flip to true while developing the extension. */
export const DEBUG = false;

const PREFIX = "[API Source]";

export function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log(PREFIX, ...args);
  }
}

export function logError(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
