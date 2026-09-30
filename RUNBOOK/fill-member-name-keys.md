# Fill the member name keys (once per database that already holds member lists)

ROADMAP 5b-iv-a; migration `0055_members_possible_duplicates`. Possible duplicates find two
records with the same name by the key kept on each record, `gym_member_list_entries.name_key`
("Shah, Priya" and "Priya Shah" are one key). The api writes it with every name from 0055
on; records written before 0055 have none until this is run.

## Symptoms

- Members shows no "may be on your list twice" sign although two records have the same name.
- `SELECT count(*) FROM gym_member_list_entries WHERE name_key IS NULL;` is above 0.

## Steps

1. Run after the migrations. It needs no secret.

   ```
   DATABASE_URL=<the environment's database> corepack pnpm --filter api exec tsx tools/member-name-keys.ts
   ```

2. It prints how many records it filled. Run it again: it prints 0.

## Verify recovered

- `SELECT count(*) FROM gym_member_list_entries WHERE name_key IS NULL;` is 0.
- Two records known to share a name show on Members as "may be on your list twice".
