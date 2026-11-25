// English is the source locale. Messages live in ./en/<feature>.ts (common, owner, coach, customer,
// plans, sessions, analytics); each feature task edits only its own file. Every key added to an
// English file must also be added to the same file under hi/ and kn/ (typed per file, and
// tests/i18n.test.ts checks it). Use {name} placeholders for dynamic values.
import { common } from "./en/common";
import { owner } from "./en/owner";
import { coach } from "./en/coach";
import { customer } from "./en/customer";
import { plans } from "./en/plans";
import { sessions } from "./en/sessions";
import { analytics } from "./en/analytics";
import { absences } from "./en/absences";
import { workoutEngine } from "./en/workout-engine";

export const en = { ...common, ...owner, ...coach, ...customer, ...plans, ...sessions, ...analytics, ...absences, ...workoutEngine } as const;

export type MessageKey = keyof typeof en;
