import type { ApiRole } from "./roles";

export type RoleRule = readonly ApiRole[] | "public";

/**
 * Allowed roles per operationId. Mirrors `x-roles` in docs/api/openapi.yaml;
 * tests/auth-policy.test.ts fails if the two drift apart.
 */
export const OPERATION_ROLES = {
  requestOtp: "public",
  verifyOtp: "public",
  exchangeMagicLink: "public",
  refreshSession: "public",
  signOut: ["owner", "coach", "customer"],
  getMe: ["owner", "coach", "customer"],
  getTenantTheme: "public",
  getCurrentTenant: ["owner", "coach", "customer"],
  updateTenantTheme: ["owner"],
  listMembers: ["owner", "coach"],
  getMember: ["owner", "coach", "customer"],
  createMemberMagicLink: ["owner", "coach"],
  importMembersCsv: ["owner"],
  listVenues: ["owner", "coach", "customer"],
  listBatches: ["owner", "coach", "customer"],
  listSessions: ["owner", "coach", "customer"],
  // Contract v0.2.0 (STAR-57)
  createSession: ["owner", "coach"],
  updateTenantSettings: ["owner"],
  listExercises: ["owner", "coach", "customer"],
  getExercise: ["owner", "coach", "customer"],
  listCoaches: ["owner"],
  getCoachStats: ["owner", "coach"],
  listCoachAvailability: ["owner", "coach"],
  replaceCoachAvailability: ["owner", "coach"],
  listWorkoutPlans: ["owner", "coach"],
  createWorkoutPlan: ["owner", "coach"],
  getWorkoutPlan: ["owner", "coach", "customer"],
  updateWorkoutPlan: ["owner", "coach"],
  archiveWorkoutPlan: ["owner", "coach"],
  listPlanAssignments: ["owner", "coach", "customer"],
  createPlanAssignments: ["owner", "coach"],
  updatePlanAssignment: ["owner", "coach"],
  getMemberSchedule: ["owner", "coach", "customer"],
  listWorkoutLogs: ["owner", "coach", "customer"],
  recordWorkoutLog: ["coach", "customer"],
  getMemberStats: ["owner", "coach", "customer"],
  listGoals: ["owner", "coach", "customer"],
  createGoal: ["owner", "coach"],
  updateGoal: ["owner", "coach"],
  addGoalCheckIn: ["owner", "coach"],
  listMemberUpdates: ["owner", "coach", "customer"],
  markMemberUpdatesRead: ["customer"],
  getSession: ["owner", "coach", "customer"],
  updateSession: ["owner", "coach"],
  recordAttendance: ["owner", "coach"],
  bookSession: ["owner", "coach", "customer"],
  cancelBooking: ["owner", "coach", "customer"],
  getOwnerOverview: ["owner"],
  getOwnerTrends: ["owner"],
  getCoachWorkload: ["owner"],
  getFeeStats: ["owner"],
  getOwnerInsights: ["owner"],
  // STAR-94: holiday calendar editor
  listHolidays: ["owner"],
  createHoliday: ["owner"],
  deleteHoliday: ["owner"],
} as const satisfies Record<string, RoleRule>;

export type OperationId = keyof typeof OPERATION_ROLES;
