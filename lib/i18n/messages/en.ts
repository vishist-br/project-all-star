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
import { credentials } from "./en/credentials";

export const en = { ...common, ...owner, ...coach, ...customer, ...plans, ...sessions, ...analytics, ...absences, ...credentials, ...progressCard, ...workoutEngine, ...sendClasses } as const;
import { progressCard } from "./en/progressCard";
import { workoutEngine } from "./en/workout-engine";
import { sendClasses } from "./en/send-classes";


export type MessageKey = keyof typeof en;
