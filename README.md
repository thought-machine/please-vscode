# VSCode extension for Please

This is the VSCode extension for the Please build system.

See https://please.build or https://github.com/thought-machine/please for more information about Please itself.

## Debugging

### Go language requirements

- [Delve](https://github.com/go-delve/delve).
- [Go Outline](https://github.com/ramya-rao-a/go-outline).

## Development

### Extension

You can test and debug your changes by selecting **View > Run** and choosing **Launch Extension** from the dropdown menu. This will load a new VSCode window instance with the changes loaded in.

### Language Server

The [Please Language Server](https://github.com/thought-machine/please/tree/master/tools/build_langserver) is maintained in a different [repository](https://github.com/thought-machine/please/tree/master/tools/build_langserver).

You can debug the communication happening between VSCode and the server:

- Add `"plz.trace.server": "verbose"` to the repo's `.vscode/settings.json`.
- Select **View > Output** from the main menu and choose **Please Language Server** from the dropdown menu.
