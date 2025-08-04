import { 
  users, 
  databaseConnections, 
  databaseSchemas, 
  chatMessages,
  type User, 
  type InsertUser,
  type DatabaseConnection,
  type InsertDatabaseConnection,
  type DatabaseSchema,
  type ChatMessage,
  type InsertChatMessage
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Database connections
  createDatabaseConnection(connection: InsertDatabaseConnection): Promise<DatabaseConnection>;
  getDatabaseConnections(): Promise<DatabaseConnection[]>;
  getDatabaseConnection(id: string): Promise<DatabaseConnection | undefined>;
  updateDatabaseConnection(id: string, updates: Partial<DatabaseConnection>): Promise<DatabaseConnection>;
  deleteDatabaseConnection(id: string): Promise<void>;
  setActiveConnection(id: string): Promise<void>;
  
  // Database schemas
  saveDatabaseSchema(connectionId: string, schemaData: any, tableCount: number): Promise<DatabaseSchema>;
  getDatabaseSchema(connectionId: string): Promise<DatabaseSchema | undefined>;
  
  // Chat messages
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessages(connectionId: string, limit?: number): Promise<ChatMessage[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async createDatabaseConnection(connection: InsertDatabaseConnection): Promise<DatabaseConnection> {
    const [dbConnection] = await db
      .insert(databaseConnections)
      .values(connection)
      .returning();
    return dbConnection;
  }

  async getDatabaseConnections(): Promise<DatabaseConnection[]> {
    return await db.select().from(databaseConnections).orderBy(desc(databaseConnections.createdAt));
  }

  async getDatabaseConnection(id: string): Promise<DatabaseConnection | undefined> {
    const [connection] = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id));
    return connection || undefined;
  }

  async updateDatabaseConnection(id: string, updates: Partial<DatabaseConnection>): Promise<DatabaseConnection> {
    const [connection] = await db
      .update(databaseConnections)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(databaseConnections.id, id))
      .returning();
    return connection;
  }

  async deleteDatabaseConnection(id: string): Promise<void> {
    await db.delete(databaseConnections).where(eq(databaseConnections.id, id));
  }

  async setActiveConnection(id: string): Promise<void> {
    // Set all connections to inactive
    await db.update(databaseConnections).set({ isActive: false });
    // Set the specified connection as active
    await db.update(databaseConnections).set({ isActive: true }).where(eq(databaseConnections.id, id));
  }

  async saveDatabaseSchema(connectionId: string, schemaData: any, tableCount: number): Promise<DatabaseSchema> {
    // Delete existing schema for this connection
    await db.delete(databaseSchemas).where(eq(databaseSchemas.connectionId, connectionId));
    
    const [schema] = await db
      .insert(databaseSchemas)
      .values({
        connectionId,
        schemaData,
        tableCount,
        lastUpdated: new Date()
      })
      .returning();
    return schema;
  }

  async getDatabaseSchema(connectionId: string): Promise<DatabaseSchema | undefined> {
    const [schema] = await db.select().from(databaseSchemas).where(eq(databaseSchemas.connectionId, connectionId));
    return schema || undefined;
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [chatMessage] = await db
      .insert(chatMessages)
      .values(message)
      .returning();
    return chatMessage;
  }

  async getChatMessages(connectionId: string, limit: number = 50): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.connectionId, connectionId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
