// DRAFT Kannada translation: needs native-speaker review.
// Split per feature like en.ts; each file is typed against its English counterpart.
import type { MessageKey } from "./en";
import { common } from "./kn/common";
import { owner } from "./kn/owner";
import { coach } from "./kn/coach";
import { customer } from "./kn/customer";
import { plans } from "./kn/plans";
import { sessions } from "./kn/sessions";
import { analytics } from "./kn/analytics";
import { absences } from "./kn/absences";
import { credentials } from "./kn/credentials";

export const kn: Record<MessageKey, string> = { ...common, ...owner, ...coach, ...customer, ...plans, ...sessions, ...analytics, ...absences, ...credentials, ...progressCard, ...workoutEngine, ...progressInsights };
import { progressCard } from "./kn/progressCard";
import { progressInsights } from "./kn/progress-insights";
import { workoutEngine } from "./kn/workout-engine";

