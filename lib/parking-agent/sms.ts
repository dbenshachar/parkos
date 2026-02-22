import "server-only";

type TwilioResponse = {
  sid?: string;
  message?: string;
};

type TwilioConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
};

function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() || null;

  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables.");
  }

  if (!messagingServiceSid && !fromNumber) {
    throw new Error("Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER for SMS delivery.");
  }

  return {
    accountSid,
    authToken,
    messagingServiceSid,
    fromNumber,
  };
}

export async function sendSmsMessage(input: { toPhoneE164: string; text: string }): Promise<{ sid: string }> {
  const config = getTwilioConfig();
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;

  const form = new URLSearchParams();
  form.set("To", input.toPhoneE164);
  form.set("Body", input.text);
  if (config.messagingServiceSid) {
    form.set("MessagingServiceSid", config.messagingServiceSid);
  } else if (config.fromNumber) {
    form.set("From", config.fromNumber);
  }

  const authToken = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as TwilioResponse;
  if (!response.ok || !payload.sid) {
    throw new Error(payload.message || `Twilio SMS request failed with status ${response.status}.`);
  }

  return { sid: payload.sid };
}
