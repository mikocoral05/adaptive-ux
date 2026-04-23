module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    customExportConditions: [""],
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.m?js$": "babel-jest",
  },
  transformIgnorePatterns: [
    "node_modules[/\\\\](?!(@mswjs|msw|rettime|outvariant|strict-event-emitter|@open-draft|until-async)[/\\\\])",
  ],
};
