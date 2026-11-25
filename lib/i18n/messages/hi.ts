// DRAFT Hindi translation: needs native-speaker review.
// Split per feature like en.ts; each file is typed against its English counterpart.
import type { MessageKey } from "./en";
import { common } from "./hi/common";
import { owner } from "./hi/owner";
import { coach } from "./hi/coach";
import { customer } from "./hi/customer";
import { plans } from "./hi/plans";
import { sessions } from "./hi/sessions";
import { analytics } from "./hi/analytics";
import { absences } from "./hi/absences";
import { credentials } from "./hi/credentials";

export const hi: Record<MessageKey, string> = { ...common, ...owner, ...coach, ...customer, ...plans, ...sessions, ...analytics, ...absences, ...credentials, ...progressCard, ...workoutEngine, ...progressInsights };
import { progressCard } from "./hi/progressCard";
import { progressInsights } from "./hi/progress-insights";
import { workoutEngine } from "./hi/workout-engine";

