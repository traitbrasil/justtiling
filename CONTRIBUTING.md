# Contributing to Trait JustTiling

Thanks for helping make GNOME workspaces more comfortable. Bug reports, focused improvements, translations, and documentation contributions are welcome.

## Report a bug

Check existing [issues](https://github.com/traitbrasil/justtiling/issues), then include:

- Trait JustTiling version and GNOME Shell version.
- Distribution, one/multiple logical monitors, and display scaling.
- Affected application and whether it is tiled or floating.
- Steps to reproduce, expected behavior, and what happened instead.
- Other enabled window-management extensions, if relevant.

Screenshots and short, redacted log excerpts can help. Remove private titles, document contents, account details, tokens, and unrelated applications. Do not attach a whole session journal or preference export by default.

## Suggest a feature

Describe the workflow and the problem first, then an example of the behavior you would like. Current support is GNOME Shell 51 with one logical monitor; proposals beyond that scope need corresponding implementation and testing plans.

## Send a change

1. Fork the repository and create a branch for a focused change.
2. Read the [development guide](docs/development.md).
3. Implement the change, keeping Shell and Preferences imports separate and cleanup synchronous.
4. Run `make check test`. Run the relevant integration checks when changing native integration, Preferences, or translations.
5. Update documentation for user-visible behavior and open a pull request explaining the problem, resulting behavior, and validation.

Use a dedicated test account or VM for manual GNOME testing. The automated suite does not activate the extension in your current session.

## Translate or improve documentation

English messages live in the source, with Gettext catalogs in `po/`. See [Translations](docs/development.md#translations) for the workflow. Keep English and Portuguese README instructions consistent when changing setup or defaults.

The [documentation](docs/README.md) describes the supported release. Keep setup instructions and feature descriptions aligned with current behavior.

## Review and licensing

Explain the code you submit and take responsibility for it, including work made with AI assistance. Read the [GNOME review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html), especially lifecycle, imports, subprocesses, and AI-generated code policy.

Contributions must be compatible with [GPL-3.0-or-later](LICENSE). Preserve third-party attribution where applicable. Contact [just@trait.com.br](mailto:just@trait.com.br) for private reports containing sensitive information; keep credentials out of public issues.
