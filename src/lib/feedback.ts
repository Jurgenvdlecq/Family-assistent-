import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { FeedbackEventType, FeedbackReason, FeedbackSubjectType } from "@/generated/prisma/enums";

export async function logFeedbackEvent(input: {
  householdId: string;
  personId?: string;
  subjectType: FeedbackSubjectType;
  subjectId: string;
  eventType: FeedbackEventType;
  reason?: FeedbackReason;
  explicit?: boolean;
  context?: Prisma.InputJsonValue;
}) {
  return prisma.feedbackEvent.create({
    data: {
      householdId: input.householdId,
      personId: input.personId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      eventType: input.eventType,
      reason: input.reason,
      explicit: input.explicit ?? false,
      context: input.context ?? {},
    },
  });
}
