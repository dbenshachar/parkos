import { NextRequest, NextResponse } from "next/server";

import { getSupabaseConfig } from "@/lib/account-store";
import {
  fetchSmsDeliveryProfileByPhone,
  updateSmsOptInByProfileId,
} from "@/lib/parking-agent/db";

const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);
const START_KEYWORDS = new Set(["start", "unstop", "subscribe"]);

function xmlResponse(message: string): NextResponse {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

function normalizePhone(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function normalizeCommand(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed.split(/\s+/)[0] || null;
}

function webhookTokenValid(request: NextRequest): boolean {
  const expected = process.env.TWILIO_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    return true;
  }

  return request.headers.get("x-twilio-webhook-token") === expected;
}

export async function POST(request: NextRequest) {
  if (!webhookTokenValid(request)) {
    return xmlResponse("Unauthorized webhook token.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return xmlResponse("Invalid webhook payload.");
  }

  const fromPhone = normalizePhone(formData.get("From"));
  const command = normalizeCommand(formData.get("Body"));

  if (!fromPhone || !command) {
    return xmlResponse("Missing sender or command.");
  }

  const config = getSupabaseConfig();
  if (!config) {
    return xmlResponse("Service unavailable.");
  }

  const profileResult = await fetchSmsDeliveryProfileByPhone(config, fromPhone);
  if (!profileResult.ok || !profileResult.value) {
    return xmlResponse("No ParkOS account was found for this number.");
  }

  if (STOP_KEYWORDS.has(command)) {
    const updated = await updateSmsOptInByProfileId(config, profileResult.value.id, false);
    if (!updated.ok) {
      return xmlResponse("Unable to update SMS preference right now.");
    }

    return xmlResponse("ParkOS SMS reminders are now disabled. Reply START to re-enable.");
  }

  if (START_KEYWORDS.has(command)) {
    const updated = await updateSmsOptInByProfileId(config, profileResult.value.id, true);
    if (!updated.ok) {
      return xmlResponse("Unable to update SMS preference right now.");
    }

    return xmlResponse("ParkOS SMS reminders are now enabled.");
  }

  return xmlResponse("ParkOS received your message. Reply STOP to opt out or START to opt in.");
}
