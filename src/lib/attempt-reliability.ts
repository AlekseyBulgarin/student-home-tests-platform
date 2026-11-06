export function serializeAnswers(answers: Record<string, string[]>) {
  return JSON.stringify(Object.entries(answers).sort(([left], [right]) => left.localeCompare(right)).map(([questionId, selected]) => [questionId, [...selected].sort()]));
}

export function formatRemaining(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
