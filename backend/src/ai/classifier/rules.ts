import { maxPriority, type Category, type Priority } from "../../domain/enums";

/**
 * Deterministic business rules applied after any classification (AI or fallback).
 * Code, not the prompt, is the source of truth for policy floors.
 */
export function applyPriorityFloor(category: Category, priority: Priority): Priority {
  // KB: "If an author reports an ISBN error ... it is treated as a high-priority issue."
  if (category === "ISBN_METADATA") return maxPriority(priority, "HIGH");
  return priority;
}
