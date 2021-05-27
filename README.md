# VSCode extension for Please

This is a VSCode extension for the Please build system.
Currently it is in a very rudimentary state.

See https://please.build or https://github.com/thought-machine/please for more information about Please itself.

## Debugging (Beta)

### Go language

> [Delve](https://github.com/go-delve/delve) and [Go Outline](https://github.com/ramya-rao-a/go-outline) are required to be installed as a prerequisite.

Open a Go test file and you should see the **plz test/debug package** code lens at the top of the file and **plz run/debug test** codelenses for every test. 

---
**NOTE**

At the moment, it is advisable to not stop a running debugging session and let it run to completion. Your tests might be allocating resources on the filesystem during setup and they likely need to be dealt with during teardown. We are looking into executing tests in a sandbox environment, so you don't have to worry about it in the future.

---

## Development

### Extension

You can test and debug your changes by selecting **View > Run** and choosing **Launch Extension** from the dropdown menu. This will load a new VSCode window instance with the changes loaded in.

### Language Server

The [Please Language Server](https://github.com/thought-machine/please/tree/master/tools/build_langserver) is maintained in a different [repository](https://github.com/thought-machine/please/tree/master/tools/build_langserver).

You can debug the communication happening between VSCode and the server:

* Add `"plz.trace.server": "verbose"` to the repo's `.vscode/settings.json`.
* Select **View > Output** from the main menu and choose **Please Language Server** from the dropdown menu.

