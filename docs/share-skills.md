# Share Skills Between Instances

Use repo-local `skills/` for portable, versioned skill modules.

## Structure

- `skills/<skill-name>/SKILL.md`
- optional `skills/<skill-name>/assets/`
- optional `skills/<skill-name>/scripts/`

Track available skills in `SKILLS_INDEX.md`.

## Export skills

```bash
./scripts/export-skills.sh my-skills.tgz
```

## Import skills

```bash
./scripts/import-skills.sh my-skills.tgz
```

## Recommended workflow

1. Create skill in `skills/`.
2. Add entry in `SKILLS_INDEX.md`.
3. Commit + push.
4. Friend pulls latest or imports exported bundle.

Keep secrets out of skill files; skills should reference env vars only.
