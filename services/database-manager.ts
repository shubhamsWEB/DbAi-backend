import pkg from 'pg';
const { Pool } = pkg;
import { storage } from '../storage';

interface DatabasePool {
  connectionId: string;
  pool: InstanceType<typeof Pool>;
  lastUsed: Date;
}

export class DatabaseManager {
  private pools: Map<string, DatabasePool> = new Map();
  private readonly maxIdleTime = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Clean up idle connections every 10 minutes
    setInterval(() => this.cleanupIdleConnections(), 10 * 60 * 1000);
  }

  async getPool(connectionId: string): Promise<InstanceType<typeof Pool>> {
    let poolInfo = this.pools.get(connectionId);
    
    if (poolInfo) {
      poolInfo.lastUsed = new Date();
      return poolInfo.pool;
    }

    // Create new pool
    const connection = await storage.getDatabaseConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection not found: ${connectionId}`);
    }

    const pool = new Pool({
      connectionString: connection.connectionUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 300000, // 5 minutes
    });

    poolInfo = {
      connectionId,
      pool,
      lastUsed: new Date()
    };

    this.pools.set(connectionId, poolInfo);
    return pool;
  }

  async testConnection(connectionUrl: string): Promise<boolean> {
    const testPool = new Pool({
      connectionString: connectionUrl,
      max: 1,
      connectionTimeoutMillis: 300000, // 5 minutes
    });

    try {
      const client = await testPool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    } finally {
      await testPool.end();
    }
  }

  async executeQuery(connectionId: string, query: string, params: any[] = []): Promise<{ rows: any[], rowCount: number, executionTime: number }> {
    const pool = await this.getPool(connectionId);
    const startTime = Date.now();
    
    try {
      const result = await pool.query(query, params);
      const executionTime = Date.now() - startTime;
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0,
        executionTime
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      console.error('Query execution failed:', error);
      throw new Error(`Query failed: ${error.message}`);
    }
  }

  private cleanupIdleConnections(): void {
    const now = new Date();
    
    for (const [connectionId, poolInfo] of Array.from(this.pools.entries())) {
      const idleTime = now.getTime() - poolInfo.lastUsed.getTime();
      
      if (idleTime > this.maxIdleTime) {
        poolInfo.pool.end().catch(console.error);
        this.pools.delete(connectionId);
        console.log(`Cleaned up idle connection: ${connectionId}`);
      }
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    const poolInfo = this.pools.get(connectionId);
    if (poolInfo) {
      await poolInfo.pool.end();
      this.pools.delete(connectionId);
    }
  }

  async closeAllConnections(): Promise<void> {
    const closePromises = Array.from(this.pools.values()).map(poolInfo => poolInfo.pool.end());
    await Promise.all(closePromises);
    this.pools.clear();
  }
}

export const databaseManager = new DatabaseManager();
