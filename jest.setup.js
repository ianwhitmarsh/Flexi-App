/* eslint-env node */
// The suite runs with TZ=UTC, set on the jest invocation itself — see the
// `test` script in package.json and the Tests step in .github/workflows.
//
// It cannot be set here: Node resolves the zone before `setupFiles` runs, so
// assigning `process.env.TZ` at this point changes nothing. It has to be in the
// environment before the process starts.
//
// Why it matters: timezone tests are worthless if the host sits in the zone
// they assert. BIG-85's were written on a machine in America/Chicago, and ten
// of twelve still passed with the zone handling removed, because "read it
// locally" and "read it in Chicago" agreed. `timezone.test.ts` asserts the pin
// took effect, so this fails loudly rather than going quietly vacuous again.

// AsyncStorage has no native module under Jest; use the shipped in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
