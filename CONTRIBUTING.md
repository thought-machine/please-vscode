# Contributing

## Testing the extension

You can test and debug your changes by selecting **View > Run** and choosing **Launch Extension** from the dropdown menu. This will load a new VSCode window instance with the changes loaded in.

If this extension needs to be tested against a locally built version of Please:

- Create an `.env` file at the root of this project - it is gitignored.
- Set `PLZ_LOCAL` to the location of the wanted binary.

## Releasing the extension

After merging a PR which increments the version number, the extension must be built and released.
The best way to do this is in a Docker container.

```shell
$ docker run -d -i --name please-vscode-release node:22
$ docker exec -it please-vscode-release /bin/bash

[docker]$ git clone https://github.com/thought-machine/please-vscode.git
[docker]$ cd please-vscode
[docker]$ npm install
[docker]$ npx @vscode/vsce package --follow-symlinks
[docker]$ exit

$ docker cp please-vscode-release:/please-vscode/plz-vscode-[VERSION].vsix .
$ docker stop please-vscode-release
$ docker rm please-vscode-release
```

Once built, the new extension version can be uploaded to the VSCode Marketplace at 
<https://marketplace.visualstudio.com/manage/publishers/please-build> - click on the 3-dot menu next
to the extension name in the table and select "Update". Upload the `.vsix` file obtained above.

## Language Server

The [Please Language Server](https://github.com/thought-machine/please/tree/master/tools/build_langserver) is maintained in a different [repository](https://github.com/thought-machine/please/tree/master/tools/build_langserver).

You can debug the communication happening between VSCode and the server:

- Add `"plz.trace.server": "verbose"` to the repo's `.vscode/settings.json`.
- Select **View > Output** from the main menu and choose **Please Language Server** from the dropdown menu.