import runCustomWorkflow from "../../workflows/custom-workflow.js";

export default async function handleCustomCard(config, csvPath) {
  return runCustomWorkflow(config, csvPath);
}
