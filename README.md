# VSCode extension for Please

This is a VSCode extension for the Please build system.
Currently it is in a very rudimentary state.

See https://please.build or https://github.com/thought-machine/please for more information about Please itself.

## Debugging (Beta)

### Go language

> [Delve](https://github.com/go-delve/delve) and [Go Outline](https://github.com/ramya-rao-a/go-outline) are required to be installed as a prerequisite.

#### Option 1

Open a Go test file and you should see the **plz test/debug package** code lens at the top of the file and **plz run/debug test** codelenses for every test.

#### Option 2

- Open **Run > Add Configuration...** and select **Please: Launch Go test target**.
- Navigate to Go test file that you want to debug and place your breakpoints.
- Select **Run > Start Debugging** from the main menu:
  - Enter the Go test file target (i.e. **//path/to/test:target**) in the first prompt.
  - (Optional) Enter the test function you are interested in. Press Enter if you want the whole test to run.

## Development

### Extension

You can test and debug your changes by selecting **View > Run** and choosing **Launch Extension** from the dropdown menu. This will load a new VSCode window instance with the changes loaded in.

### Language Server

The [Please Language Server](https://github.com/thought-machine/please/tree/master/tools/build_langserver) is maintained in a different [repository](https://github.com/thought-machine/please/tree/master/tools/build_langserver).

You can debug the communication happening between VSCode and the server:

- Add `"plz.trace.server": "verbose"` to the repo's `.vscode/settings.json`.
- Select **View > Output** from the main menu and choose **Please Language Server** from the dropdown menu.
