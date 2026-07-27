# Frozen schema fixtures

`schema-before-tstzrange.sql` is `db/schema.sql` exactly as it stood before
`bookings.slot` became a `tstzrange` — the state any database created up to that
point is in.

It is a frozen copy on purpose. The migration test needs a real "before" to
upgrade *from*, and reading that from `git show HEAD:db/schema.sql` would stop
working the moment the change was committed: HEAD would be the new schema, the
test would migrate the new schema to itself, and it would pass without testing
anything.

Do not update it to match `db/schema.sql`. If a later change needs its own
starting point, add another frozen file beside this one.
