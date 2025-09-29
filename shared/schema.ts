import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  varchar,
  timestamp,
  decimal,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// Users table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: userRoleEnum("role").notNull().default("user"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Keyword data categories
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  parentId: varchar("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  // Performance indexes for category queries
  index("idx_categories_parent_id").on(table.parentId),
  index("idx_categories_name").on(table.name),
]);

// TikTok Shop keyword data
export const keywords = pgTable("keywords", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  keyword: text("keyword").notNull(),
  searchVolume: integer("search_volume").notNull(),
  productClickScore: decimal("product_click_score", { precision: 10, scale: 2 }).notNull(),
  skuSalesScore: decimal("sku_sales_score", { precision: 10, scale: 2 }),
  availableProducts: integer("available_products").notNull(),
  averagePrice: decimal("average_price", { precision: 10, scale: 2 }).notNull(),
  ctrScore: decimal("ctr_score", { precision: 10, scale: 2 }).notNull(),
  ctorScore: decimal("ctor_score", { precision: 10, scale: 2 }).notNull(),
  categoryId: varchar("category_id").references(() => categories.id),
  // Original CSV category columns
  category: text("category"),
  subCategory1: text("sub_category_1"),
  subCategory2: text("sub_category_2"),
  uploadPeriod: varchar("upload_period", { length: 20 }), // e.g., "2025-07" or "2025-07-14" (legacy)
  // New date range fields from CSV data
  startDate: date("start_date"), // Parsed from CSV date range
  endDate: date("end_date"), // Parsed from CSV date range
  isActive: boolean("is_active").notNull().default(true),
  isHpk: boolean("is_hpk").notNull().default(false), // High-Potential Keyword flag
  isRk: boolean("is_rk").notNull().default(false), // Rising Keyword flag
  rank: integer("rank"), // RK-specific rank field
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Performance indexes for common queries
  index("idx_keywords_upload_period").on(table.uploadPeriod),
  index("idx_keywords_start_date").on(table.startDate),
  index("idx_keywords_end_date").on(table.endDate),
  index("idx_keywords_category").on(table.category),
  index("idx_keywords_sub_category_1").on(table.subCategory1),
  index("idx_keywords_sub_category_2").on(table.subCategory2),
  index("idx_keywords_search_volume").on(table.searchVolume),
  index("idx_keywords_is_active").on(table.isActive),
  index("idx_keywords_keyword").on(table.keyword),
  // Composite indexes for common filter combinations
  index("idx_keywords_period_category").on(table.uploadPeriod, table.category),
  index("idx_keywords_period_active").on(table.uploadPeriod, table.isActive),
  index("idx_keywords_category_active").on(table.category, table.isActive),
  index("idx_keywords_date_range_active").on(table.startDate, table.endDate, table.isActive),
]);

export const emailSubscribers = pgTable("email_subscribers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  status: text("status").notNull().default('active'), // active, unsubscribed
});

// User activity tracking tables for usage statistics
export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Make nullable to allow anonymous sessions
  sessionId: varchar("session_id"), // Browser session ID
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address"),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_sessions_user_id").on(table.userId),
  index("idx_user_sessions_start_time").on(table.startTime),
  index("idx_user_sessions_is_active").on(table.isActive),
]);

export const userActivities = pgTable("user_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // Make nullable to allow anonymous activities
  sessionId: varchar("session_id"), // Make nullable for flexibility
  activityType: varchar("activity_type").notNull(), // 'search', 'login', 'page_view', 'export', etc.
  activityData: jsonb("activity_data"), // Additional data about the activity
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_user_activities_user_id").on(table.userId),
  index("idx_user_activities_session_id").on(table.sessionId),
  index("idx_user_activities_type").on(table.activityType),
  index("idx_user_activities_timestamp").on(table.timestamp),
]);

// Relations
export const categoryRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
  }),
  children: many(categories),
  keywords: many(keywords),
}));

export const keywordRelations = relations(keywords, ({ one }) => ({
  category: one(categories, {
    fields: [keywords.categoryId],
    references: [categories.id],
  }),
}));

export const userSessionRelations = relations(userSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
  activities: many(userActivities),
}));

export const userActivityRelations = relations(userActivities, ({ one }) => ({
  user: one(users, {
    fields: [userActivities.userId],
    references: [users.id],
  }),
  session: one(userSessions, {
    fields: [userActivities.sessionId],
    references: [userSessions.id],
  }),
}));

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(userSessions),
  activities: many(userActivities),
}));

// Schema validations
export const upsertUserSchema = createInsertSchema(users);
export const insertEmailSubscriberSchema = createInsertSchema(emailSubscribers).pick({
  email: true,
});

export const insertUserSessionSchema = createInsertSchema(userSessions).pick({
  userId: true,
  sessionId: true,
  userAgent: true,
  ipAddress: true,
  startTime: true,
  endTime: true,
}).partial({ endTime: true });

export const insertUserActivitySchema = createInsertSchema(userActivities).pick({
  userId: true,
  sessionId: true,
  activityType: true,
  activityData: true,
  timestamp: true,
}).partial({ timestamp: true });

export const insertCategorySchema = createInsertSchema(categories).pick({
  name: true,
  parentId: true,
});

export const insertKeywordSchema = createInsertSchema(keywords).pick({
  keyword: true,
  searchVolume: true,
  productClickScore: true,
  skuSalesScore: true,
  availableProducts: true,
  averagePrice: true,
  ctrScore: true,
  ctorScore: true,
  categoryId: true,
  category: true,
  subCategory1: true,
  subCategory2: true,
  uploadPeriod: true,
  startDate: true,
  endDate: true,
  isHpk: true,
  isRk: true,
  rank: true,
}).partial({ categoryId: true, uploadPeriod: true, startDate: true, endDate: true, isHpk: true, isRk: true, rank: true });

export const updateKeywordSchema = createInsertSchema(keywords).pick({
  keyword: true,
  searchVolume: true,
  productClickScore: true,
  skuSalesScore: true,
  availableProducts: true,
  averagePrice: true,
  ctrScore: true,
  ctorScore: true,
  categoryId: true,
  isActive: true,
}).partial();


// Types
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertEmailSubscriber = z.infer<typeof insertEmailSubscriberSchema>;
export type EmailSubscriber = typeof emailSubscribers.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = z.infer<typeof insertKeywordSchema>;
export type UpdateKeyword = z.infer<typeof updateKeywordSchema>;
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserActivity = typeof userActivities.$inferSelect;
export type InsertUserActivity = z.infer<typeof insertUserActivitySchema>;


