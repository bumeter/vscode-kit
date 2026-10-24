# Bumeter VS Code kit

What every [Bumeter](https://bumeter.cc) VS Code extension shares: talking to `bum rpc`, finding the `bum` bundled with the extension, the app's number formats, and the quota/context status bar item. Used by [Bumeter for VS Code](https://github.com/bumeter/vscode) and [Claude Code Usage](https://github.com/bumeter/claude-usage).

```
npm install --save-dev @bumeter/vscode-kit
```

```ts
import { findBum, RpcClient, StatusBar, projectOf, langOf } from '@bumeter/vscode-kit';

const bin = findBum({ setting: '', extensionPath: ctx.extensionPath });
const rpc = RpcClient.forBinary(bin!);
const bar = new StatusBar(rpc, projectOf(vscode.workspace.workspaceFolders), langOf(vscode.env.language), {
  id: 'myExt.status', name: 'My extension', click: 'myExt.refresh', fallback: 'Quota',
  noLimits: 'No 5h/7d numbers yet.', links: [{ label: 'Refresh', command: 'myExt.refresh' }],
});
```

| Module | |
|---|---|
| `rpc` | `RpcClient`: one `bum rpc` process, JSON lines, restarts, events (`host`, `scanning`, `data_changed`, `alert`) |
| `binary` | `findBum`: the setting, then `bin/<platform>/bum` in the extension, then `PATH`; `ensureExecutable` |
| `status` | `renderStatus` (pure) and `StatusBar`: `5h 62% · 7d 41% · ctx 312K`, colors, tooltip |
| `format` | tokens, countdowns, clock, text bar; shared strings (vi/en) and `localize` for a product's own |
| `project` | `projectOf`: a workspace's project name, the way Bumeter names them |

Each module can also be imported on its own (`@bumeter/vscode-kit/format`); `format`, `binary` and `project` do not load `vscode`, so a product's pure code can be unit-tested without it. The package ships compiled JavaScript and types, with subpaths in `exports`: an extension bundles it with esbuild (`external: ['vscode']`) and type-checks with `"moduleResolution": "bundler"`. To try a change in an extension without publishing: `npm run build && npm link`, then `npm link @bumeter/vscode-kit` there.

Release: bump `version` in `package.json`, tag `vX.Y.Z`; the workflow publishes to npm.

License: GPL-3.0-or-later.
