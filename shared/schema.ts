import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const databaseConnections = pgTable("database_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  connectionUrl: text("connection_url").notNull(),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const databaseSchemas = pgTable("database_schemas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => databaseConnections.id),
  schemaData: jsonb("schema_data").notNull(),
  tableCount: integer("table_count").notNull(),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => databaseConnections.id),
  type: text("type").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  sqlQuery: text("sql_query"),
  queryResults: jsonb("query_results"),
  executionTime: integer("execution_time"), // in milliseconds
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertDatabaseConnectionSchema = createInsertSchema(databaseConnections).pick({
  name: true,
  connectionUrl: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).pick({
  connectionId: true,
  type: true,
  content: true,
  sqlQuery: true,
  queryResults: true,
  executionTime: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type DatabaseConnection = typeof databaseConnections.$inferSelect;
export type InsertDatabaseConnection = z.infer<typeof insertDatabaseConnectionSchema>;
export type DatabaseSchema = typeof databaseSchemas.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
