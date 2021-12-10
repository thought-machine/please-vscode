# VSCode extension for Please

This is the VSCode extension for the Please build system.

See https://please.build or https://github.com/thought-machine/please for more information about Please itself.

## Debugging

### Go language requirements

- Go
- [Delve](https://github.com/go-delve/delve).
- [Go Outline](https://github.com/ramya-rao-a/go-outline).

### Python language requirements

- Python 3

## Development

### Extension

You can test and debug your changes by selecting **View > Run** and choosing **Launch Extension** from the dropdown menu. This will load a new VSCode window instance with the changes loaded in.

If this extension needs to be tested against a locally built version of Please:
- Create an `.env` file at the root of this project - it is gitignored.
- Set `PLZ_LOCAL` to the location of the wanted binary.

### Language Server

The [Please Language Server](https://github.com/thought-machine/please/tree/master/tools/build_langserver) is maintained in a different [repository](https://github.com/thought-machine/please/tree/master/tools/build_langserver).

You can debug the communication happening between VSCode and the server:

- Add `"plz.trace.server": "verbose"` to the repo's `.vscode/settings.json`.
- Select **View > Output** from the main menu and choose **Please Language Server** from the dropdown menu.
