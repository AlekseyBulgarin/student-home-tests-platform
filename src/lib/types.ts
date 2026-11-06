export type Student = { id: string; first_name: string; last_name: string; note: string | null; created_at: string };
export type Version = { id: string; version_number: number; status: "draft" | "published"; published_at: string | null };
export type Test = { id: string; title: string; description: string; created_at: string; test_versions: Version[] };
export type AttemptSummary = { id: string; status: string; score_points: number | null; max_points: number | null; score_percent: number | null; submitted_at: string | null };
export type Assignment = { id: string; student_id: string; version_id: string; deadline_at: string; revoked_at: string | null; attempts: AttemptSummary[] };
export type Dashboard = { students: Student[]; tests: Test[]; assignments: Assignment[] };

export type SafeQuestion = {
  id: string; stable_id: string; type: "single_choice" | "multiple_choice"; text: string;
  points: number; position: number; options: Array<{ id: string; text: string }>; topics: string[];
};
export type AttemptState = {
  attempt: { id: string; status: string; started_at: string; deadline_at: string; revision: number; server_time: string; last_event_sequence: number; score_points: number | null; max_points: number | null; score_percent: number | null; submitted_at: string | null };
  questions: SafeQuestion[];
  answers: Record<string, string[]>;
};

export type Report = {
  revealed: boolean;
  attempt: { id: string; status: string; started_at: string; submitted_at: string | null; duration_seconds: number | null; score_points: number; max_points: number; score_percent: number };
  items?: Array<{ question_id: string; stable_id: string; text: string; selected: Array<{ id: string; text: string }>; correct: Array<{ id: string; text: string }>; explanation: string; earned_points: number; max_points: number; is_correct: boolean }>;
  topics?: Array<{ id: string; name: string; earned: number; max: number; count: number; percentage: number; status: "review" | "reinforce" | "successful"; limited_evidence: boolean }>;
  event_intervals?: Array<{ started_at: string; ended_at: string; types: string[]; summary: string }>;
};
