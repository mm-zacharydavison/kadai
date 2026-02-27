export default {
  plugins: [
    { npm: "@zdavison/claude-tools" },
    { npm: "kadai-devops-scripts", version: "^1.0.0" },
    { github: "zdavison/kadai-shared", ref: "main" },
    { path: "../shared-scripts" },
  ],
};
