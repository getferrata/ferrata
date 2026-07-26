import { z } from "zod";

/** schedule output: the course-level study plan as markdown. */
export const scheduleSchema = z.object({
  scheduleMd: z.string().min(80),
});

export type ScheduleResult = z.infer<typeof scheduleSchema>;
