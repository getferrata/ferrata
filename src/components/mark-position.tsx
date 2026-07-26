"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget beacon: records that the student opened this module, so the
 * course can offer "resume where you left off". Silent on failure; a missed
 * bookmark is never worth interrupting reading.
 */
export function MarkPosition({
  courseId,
  moduleId,
}: {
  courseId: string;
  moduleId: string;
}) {
  useEffect(() => {
    const ctrl = new AbortController();
    void fetch(`/api/courses/${courseId}/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleId }),
      signal: ctrl.signal,
      keepalive: true,
    }).catch(() => {});
    return () => ctrl.abort();
  }, [courseId, moduleId]);

  return null;
}
