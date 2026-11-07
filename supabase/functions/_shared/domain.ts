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

export type GradeThreshold = { label: string; min_percent: number };

export function validGradeThresholds(thresholds: GradeThreshold[]) {
  if (thresholds.length < 2 || thresholds.length > 10 || thresholds.at(-1)?.min_percent !== 0) return false;
  const labels = new Set<string>();
  return thresholds.every((threshold, index) => {
    if (!threshold.label.trim() || threshold.label.length > 20 || threshold.min_percent < 0 || threshold.min_percent > 100 || labels.has(threshold.label)) return false;
    labels.add(threshold.label);
    return index === 0 || threshold.min_percent < thresholds[index - 1].min_percent;
  });
}

export function gradeLabelForPercent(thresholds: GradeThreshold[], percentage: number) {
  if (!validGradeThresholds(thresholds)) throw new Error("invalid_grade_scale");
  return thresholds.find((threshold) => percentage >= threshold.min_percent)?.label ?? thresholds.at(-1)!.label;
}

export type TelemetryEvent = {
  type: string;
  client_occurred_at: string;
  received_at?: string;
};

export type TelemetryInterval = {
  started_at: string;
  ended_at: string;
  types: string[];
  summary: string;
};

const eventLabels: Record<string, string> = {
  fullscreen_exit: "выход из полноэкранного режима",
  fullscreen_enter: "возврат в полноэкранный режим",
  visibility_hidden: "вкладка скрыта",
  visibility_visible: "вкладка снова видима",
  window_blur: "окно потеряло фокус",
  window_focus: "окно получило фокус",
  copy_attempt: "стандартная попытка копирования в задании",
  offline: "потеря соединения",
  online: "соединение восстановлено",
};

export function groupTelemetryEvents(events: TelemetryEvent[], windowMs = 2500): TelemetryInterval[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.client_occurred_at) - Date.parse(b.client_occurred_at));
  const groups: TelemetryEvent[][] = [];
  for (const event of sorted) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (!group || !last || Date.parse(event.client_occurred_at) - Date.parse(last.client_occurred_at) > windowMs) groups.push([event]);
    else group.push(event);
  }
  return groups.map((group) => {
    const types = [...new Set(group.map((event) => event.type))];
    return {
      started_at: group[0].client_occurred_at,
      ended_at: group[group.length - 1].client_occurred_at,
      types,
      summary: types.map((type) => eventLabels[type] ?? type).join(", "),
    };
  });
}
