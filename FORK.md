# Double Movement Plus

A fork of [Wooting Double Movement](https://github.com/WootingKb/wooting-double-movement) (discontinued by Wooting) with movement upgrades, bug fixes and no network access. See the in-app update notes (click the version number) for the full list of changes.

**Before using it in a game, check that game's rules.** Fortnite treats macros as cheating; the riskier options (snap-tap style opposite-key modes and turn smoothing) are off by default and marked with a warning.

## Building this fork (Windows)

Requirements: Git, Rust (MSVC toolchain via rustup), Visual Studio Build Tools ("Desktop development with C++"), **Node 16** (e.g. via nvm-windows) and Yarn.

```
yarn            # installs dependencies and builds the Rust module
yarn build      # bundles the app
yarn start      # runs it
yarn dist       # builds the installer (downloads pinned, checksum-verified driver installers)
```

On Node 17 or newer, set `NODE_OPTIONS=--openssl-legacy-provider` before `yarn build`.

Run the movement unit tests with `cargo test --manifest-path src/native/Cargo.toml --lib`.
