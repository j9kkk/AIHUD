export * from './normalize.js';
export * from './driver.js';

import { CodexDriver } from './driver.js';

export function createCodexDriver(): CodexDriver {
  return new CodexDriver();
}
