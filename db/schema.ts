import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  slug: text("slug").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  adminTokenHash: text("admin_token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_groups_name_key").on(table.nameKey),
  uniqueIndex("idx_groups_slug").on(table.slug),
]);

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  color: text("color").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_participants_group_id").on(table.groupId)]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "member"] }).notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const calendarConnections = sqliteTable("calendar_connections", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google", "microsoft", "mcp"] }).notNull(),
  accountRef: text("account_ref").notNull(),
  displayName: text("display_name").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_connections_participant_provider").on(table.participantId, table.provider)]);

export const oauthStates = sqliteTable("oauth_states", {
  tokenHash: text("token_hash").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google", "microsoft"] }).notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
