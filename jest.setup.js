/* eslint-env node */
// AsyncStorage has no native module under Jest; use the shipped in-memory mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
