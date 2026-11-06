export type QuestionKind = "single_choice" | "multiple_choice";

export type ImportedQuestion = {
  id: string;
  type: QuestionKind;
  text: string;
  options: Array<{ id: string; text: string; explanation?: string }>;
  correct_option_ids: string[];
  points: number;
  topics: string[];
  explanation: string;
};

export type ImportedTest = {
  schema_version: 1;
  title: string;
  description?: string;
  settings?: { time_limit_minutes?: number; disclosure_policy?: "immediate" | "after_deadline" | "teacher_released" };
  questions: ImportedQuestion[];
};

export function normalizeSelection(value: string[]): string[] {
  return [...new Set(value)].sort();
}

export function isExactSelection(selected: string[], correct: string[]): boolean {
  const left = normalizeSelection(selected);
  const right = normalizeSelection(correct);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function scoreQuestion(selected: string[], correct: string[], points: number): number {
  return isExactSelection(selected, correct) ? points : 0;
}

export function topicStatus(percentage: number, reviewBelow = 60, reinforceBelow = 80) {
  if (percentage < reviewBelow) return "review" as const;
  if (percentage < reinforceBelow) return "reinforce" as const;
  return "successful" as const;
}
