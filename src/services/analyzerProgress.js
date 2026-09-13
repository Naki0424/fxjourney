export const analysisSteps = [
  "Detecting chart patterns",
  "Analyzing market structure",
  "Identifying key levels",
  "Recognizing trend & context",
  "Extracting text & information",
  "Generating insights & summary",
  "Auto-categorizing",
];

export function createAnalysisProgress(onUpdate) {
  let index = 0;
  let timer;

  const advance = () => {
    onUpdate((current) =>
      current.map((step, stepIndex) => ({
        ...step,
        status: stepIndex < index ? "complete" : stepIndex === index ? "processing" : "pending",
      })),
    );
    index += 1;
    if (index < analysisSteps.length) timer = setTimeout(advance, 210);
  };

  advance();
  return () => clearTimeout(timer);
}
