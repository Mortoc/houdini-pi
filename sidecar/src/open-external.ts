/**
 * Open a URL in the user's default browser, from the sidecar process.
 *
 * The pane is an app, not a browser: links in answers and model text must
 * never navigate the webview. Instead the UI sends `open_external` and this
 * fires the OS default handler (`xdg-open` / `open` / `start`).
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

/** The command and argument shape each platform needs to open a URL. */
function opener(url: string): { command: string; args: string[] } {
  switch (platform()) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

export function openExternal(url: string, exec: typeof execFile = execFile): void {
  // Only http(s) and mailto: a markdown link should never fire a file:// or
  // javascript: URL through the shell.
  if (!/^(https?|mailto):/i.test(url)) return;
  const { command, args } = opener(url);
  exec(command, args, (error) => {
    if (error !== null) console.error(`[houdini-pi] could not open ${url}: ${error.message}`);
  });
}
