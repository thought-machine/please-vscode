VSCode extension for Please
===========================

This is a VSCode extension for the Please build system.
Currently it is in a very rudimentary state.

See https://please.build or https://github.com/thought-machine/please for more information
about Please itself.

## Debugging (Beta)

### Go language

> The [Delve](https://github.com/go-delve/delve) debugger is required to be installed as a prerequisite.

* Open **Run > Add Configuration...** and select **Please: Launch Go test target**.
* Navigate to Go test file that you want to debug and place your breakpoints.
* Select **Run > Start Debugging** from the main menu:
  * Enter the Go test file target (i.e. **//path/to/test:target**) in the first prompt.
  * (Optional) Enter the test function you are interested in. Press Enter if you want the whole test to run.

