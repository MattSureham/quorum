const SAFE_CLI_VALUE = /^[A-Za-z0-9._:/@+-]+$/;
const WINDOWS_SHELL_META = /[&|<>^%!\r\n"]/u;

export function safeCliValue(value: string, label: string): string {
  if (!SAFE_CLI_VALUE.test(value)) throw new Error(`${label} contains unsupported command-line characters`);
  return value;
}

export function safeWindowsBinary(value: string, label = "CLI binary path"): string {
  if (process.platform === "win32" && WINDOWS_SHELL_META.test(value)) {
    throw new Error(`${label} contains unsupported Windows shell characters`);
  }
  return value;
}
