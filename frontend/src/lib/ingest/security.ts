import crypto from "node:crypto";

import { NextRequest } from "next/server";

import { env } from "@/lib/env";
import type { SourceType } from "@/lib/types";

export async function verifyWebhook(request: NextRequest, rawBody: string, source: SourceType) {
  if (source === "github") return verifyGitHub(request, rawBody);
  if (source === "gitlab") return verifyToken(request, "x-gitlab-token", env.webhookSecretGitlab);
  if (source === "slack") return verifySlack(request, rawBody);
  if (source === "discord") return verifyToken(request, "x-bridge-secret", env.webhookSecretDiscord);
  if (source === "meetings") return verifyToken(request, "x-bridge-secret", env.webhookSecretMeetings);
  return true;
}

function verifyGitHub(request: NextRequest, rawBody: string) {
  if (!env.webhookSecretGithub) return true;

  const signature = request.headers.get("x-hub-signature-256");
  if (!signature) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", env.webhookSecretGithub)
    .update(rawBody)
    .digest("hex")}`;

  return timingSafeEqual(signature, expected);
}

function verifySlack(request: NextRequest, rawBody: string) {
  if (!env.webhookSecretSlack) return true;

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", env.webhookSecretSlack).update(base).digest("hex")}`;
  return timingSafeEqual(signature, expected);
}

function verifyToken(request: NextRequest, header: string, secret?: string) {
  if (!secret) return true;
  return timingSafeEqual(request.headers.get(header) ?? "", secret);
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
