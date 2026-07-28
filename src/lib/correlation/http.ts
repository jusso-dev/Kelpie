import { NextResponse } from "next/server";
import {
  CorrelationError,
  CorrelationVersionConflictError,
} from "./membership-core";

export function correlationErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof CorrelationVersionConflictError) {
    return NextResponse.json(
      { error: "version_conflict", current: err.current },
      { status: 409 },
    );
  }
  if (err instanceof CorrelationError) {
    return NextResponse.json(
      { error: err.message, ...(err.details ? { details: err.details } : {}) },
      { status: err.status },
    );
  }
  return null;
}
