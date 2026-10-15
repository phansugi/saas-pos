import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyActor } from "./lib/auth";

/**
 * Minimal user records. Once Convex Auth is enabled these rows are created by
 * the auth callbacks (ctx.auth.getUserIdentity()); the shape stays the same so
 * the rest of the backend does not change.
 */

export const createOrGet = mutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Email tidak valid.");

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existing) return { userId: existing._id, created: false };

    const userId = await ctx.db.insert("users", {
      name: args.name,
      email,
      createdAt: Date.now(),
    });
    return { userId, created: true };
  },
});

/** Own profile only — a user row carries an email address. */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);
    return await ctx.db.get(args.userId);
  },
});
