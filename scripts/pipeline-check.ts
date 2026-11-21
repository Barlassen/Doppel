// Run the production browser pipeline. Build first with `npm run build`.
void import("./browser-smoke.mjs").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
