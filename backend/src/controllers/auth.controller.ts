import { Request, Response } from "express";
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { sendMail } from "@/lib/mailer";
import { signupOtpEmail } from "@/email/signupOtp.email";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const requestOtpSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function signToken(user: { id: string; role: string }) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET as string, {
    expiresIn: "7d",
  });
}

function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export async function requestSignupOtp(req: Request, res: Response) {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const existingPending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (existingPending && Date.now() - existingPending.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
    return res.status(429).json({ message: "Please wait a bit before requesting another code" });
  }

  const code = generateOtp();
  const [hashedPassword, codeHash] = await Promise.all([
    bcrypt.hash(password, 10),
    bcrypt.hash(code, 10),
  ]);

  await prisma.pendingSignup.upsert({
    where: { email },
    create: {
      email,
      name,
      password: hashedPassword,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
    update: {
      name,
      password: hashedPassword,
      codeHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      lastSentAt: new Date(),
    },
  });

  const { subject, html } = signupOtpEmail(code);
  await sendMail(email, subject, html);

  res.status(200).json({ message: "Verification code sent" });
}

export async function verifySignupOtp(req: Request, res: Response) {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const { email, code } = parsed.data;

  const pending = await prisma.pendingSignup.findUnique({ where: { email } });
  if (!pending) {
    return res.status(400).json({ message: "No signup in progress for this email — request a new code" });
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.pendingSignup.delete({ where: { email } });
    return res.status(400).json({ message: "Code expired — request a new one" });
  }

  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.pendingSignup.delete({ where: { email } });
    return res.status(400).json({ message: "Too many incorrect attempts — request a new code" });
  }

  const valid = await bcrypt.compare(code, pending.codeHash);
  if (!valid) {
    await prisma.pendingSignup.update({
      where: { email },
      data: { attempts: pending.attempts + 1 },
    });
    return res.status(401).json({ message: "Incorrect code" });
  }

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: pending.name, email: pending.email, password: pending.password },
    });
    await tx.wallet.create({ data: { userId: created.id, balance: 0 } });
    await tx.pendingSignup.delete({ where: { email } });
    return created;
  });

  const token = signToken(user);
  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
