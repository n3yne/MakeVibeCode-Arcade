# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the affected platform and version.

## Scope and known design trade-offs

- **API keys are stored unencrypted** in local app storage (see [README](README.md#privacy-and-safety)). Use keys with spending limits and revoke any that may be exposed.
- The Electron app injects a permissive Content-Security-Policy and enables `<webview>` so it can embed `arcade.makecode.com`. Only that origin is loaded by default.
- USB, Bluetooth, serial and HID permissions are auto-granted so MakeCode can flash hardware.
- The jailbreak filter and safety prompt are best-effort mitigations, not guarantees.

Reports about these are still welcome, especially ways to make them stricter.
