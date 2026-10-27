# Repository workflow

- Use the authenticated GitHub connector for remote Git operations in Codex. This is the working connection used for this repository; terminal HTTPS credentials and SSH host trust may be unavailable.
- Read the **GitHub connection in Codex** section in `docs/development.md` before publishing commits. Discover the connector tools dynamically; their names may vary between sessions.
- Validate local changes and compare the remote branch head before writing. Publish only the requested branch, without force pushes, and verify the resulting remote ref and tree.
- Keep the local branch and its remote-tracking ref synchronized with the exact verified remote commit after API publication. The API may assign a different commit SHA even when the tree and message are identical.
- Never extract connector tokens, browser cookies, or other credentials to configure terminal Git. Do not change the repository remote or SSH trust to work around missing terminal authentication.
