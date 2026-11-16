# Repository instructions

## Google Modern Web Guidance

The official Google skill is installed locally and must not be committed. Its generated `skills-lock.json` belongs in Git.

From the repository root, restore the skill with npx:

```sh
npx --yes skills@latest install --agent codex
```

Read `.agents/skills/modern-web-guidance/SKILL.md` before HTML, CSS, or client-side JavaScript work and follow its search/retrieve guidance. Installation copies the skill into the ignored `.agents/skills/` directory.

To intentionally add or update this skill and refresh the lockfile:

```sh
npx --yes skills@latest add GoogleChrome/modern-web-guidance --skill modern-web-guidance --agent codex --yes --copy
```

Commit reviewed changes to `skills-lock.json` and these instructions; keep the installed skill content local.
