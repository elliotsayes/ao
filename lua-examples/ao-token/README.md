# AO Token

An TEST `ao` token with functions:

- balance
- transfer
- mint

<!-- toc -->

- [Usage](#usage)
- [Testing](#testing)
- [Resources](#resources)

<!-- tocstop -->

## Usage

> ℹ️ **Note:** This is an important piece of information. Please read and understand before proceeding.

`contract.lua` and `index.lua` are the same thing. The only difference is that in order to bundle the program into 1 file, I manually copied all of the code into `contract.lua`.  Hopefully there will be a bundling tool that can do this easier soon.

The tests use `index.lua`.


1. Deploy the contract.

```zsh
npm run launch
```

This will give you a link to the app that shows the current state of the process.  There's a button on the bottom of that page that lets you `mint` with your connected wallet.

2. Mint locally

If you'd like to run this against a local running server.  Launch the servers in `servers`:



```zsh
(cd servers/mu && npm start) && (cd servers/cu-legacy && npm start)
```
```zsh
PROCESS_ID=<process-id> npm run run
```

## Testing

- `ao run test/contract.test.lua`

## Resources

- https://crocks.dev/docs/crocks/Either.html