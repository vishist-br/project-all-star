import type { PrismaClient } from "@prisma/client";
import { istToday } from "./cross-role";

/**
 * A daily plan for one demo-gym member that has everything the live screen shows today: a superset
 * of two exercises with 3 rounds and a shared 60 s rest, a single exercise, and a time, a distance
 * and a score exercise. Scratch database only (the e2e scratch DB). Returns what the spec needs.
 */
export async function seedLivePlan(db: PrismaClient, opts: { memberName: string; planTitle: string }) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "demo-gym" }, select: { id: true } });
  const member = await db.member.findFirstOrThrow({ where: { tenantId: tenant.id, displayName: opts.memberName } });
  const coach = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, email: "c1@demo-gym.example.test" } });
  const ex = async (name: string) => (await db.exercise.findFirstOrThrow({ where: { tenantId: tenant.id, name } })).id;

  const plan = await db.workoutPlan.create({
    data: {
      tenantId: tenant.id,
      coachId: coach.id,
      title: opts.planTitle,
      cadence: "DAILY",
      status: "ACTIVE",
      days: {
        create: {
          tenantId: tenant.id,
          dayIndex: 1,
          title: "Live demo day",
          items: {
            create: [
              { tenantId: tenant.id, exerciseId: await ex("Barbell Bench Press - Medium Grip"), position: 1, sets: 3, reps: 8, targetWeightKg: 40, restSeconds: 60, supersetGroup: "A", rounds: 3 },
              { tenantId: tenant.id, exerciseId: await ex("Bent Over Barbell Row"), position: 2, sets: 3, reps: 8, targetWeightKg: 35, restSeconds: 60, supersetGroup: "A", rounds: 3 },
              { tenantId: tenant.id, exerciseId: await ex("Barbell Squat"), position: 3, sets: 2, reps: 5, targetWeightKg: 60, restSeconds: 45 },
              { tenantId: tenant.id, exerciseId: await ex("Treading water"), position: 4, sets: 2, durationSeconds: 30, restSeconds: 20 },
              { tenantId: tenant.id, exerciseId: await ex("Freestyle laps at steady pace"), position: 5, sets: 1, targetDistanceMeters: 50, restSeconds: 30 },
              { tenantId: tenant.id, exerciseId: await ex("Smash target drill"), position: 6, sets: 1, reps: 10, restSeconds: 30 },
            ],
          },
        },
      },
    },
    include: { days: { include: { items: true } } },
  });
  const assignment = await db.planAssignment.create({
    data: { tenantId: tenant.id, planId: plan.id, memberId: member.id, assignedById: coach.id, status: "ACTIVE", startsOn: new Date(`${istToday(-3)}T00:00:00Z`), planVersion: plan.version },
  });
  return { tenantId: tenant.id, memberId: member.id, planId: plan.id, assignmentId: assignment.id, items: plan.days[0]!.items };
}
