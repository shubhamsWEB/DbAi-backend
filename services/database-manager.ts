import pkg from 'pg';
const { Pool } = pkg;
import mysql from 'mysql2/promise';
import { detectDatabaseType, type DatabaseType } from './database-utils';
import { storage } from '../storage';
import { 
  determineQueryTimeout, 
  withTimeout, 
  createQueryMetrics, 
  logQueryMetrics,
  type TimeoutConfig 
} from './query-timeout-utils';

interface DatabasePool {
  connectionId: string;
  pool: InstanceType<typeof Pool> | mysql.Pool;
  type: DatabaseType;
  lastUsed: Date;
}

export class DatabaseManager {
  private pools: Map<string, DatabasePool> = new Map();
  private readonly maxIdleTime = 30 * 60 * 1000; // 30 minutes

  constructor() {
    // Clean up idle connections every 10 minutes
    setInterval(() => this.cleanupIdleConnections().catch(console.error), 10 * 60 * 1000);
  }

  async getPool(connectionId: string): Promise<InstanceType<typeof Pool> | mysql.Pool> {
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

    const dbType = detectDatabaseType(connection.connectionUrl);
    let pool: InstanceType<typeof Pool> | mysql.Pool;

    if (dbType === 'mysql') {
      pool = mysql.createPool(connection.connectionUrl);
    } else {
      pool = new Pool({
        connectionString: connection.connectionUrl,
        max: 10,
        idleTimeoutMillis: 30000, // 30 seconds idle timeout
        connectionTimeoutMillis: 60000, // 60 seconds to establish connection
        query_timeout: 60000, // 60 seconds for queries
      });
    }

    poolInfo = {
      connectionId,
      pool,
      type: dbType,
      lastUsed: new Date()
    };

    this.pools.set(connectionId, poolInfo);
    return pool;
  }

  async testConnection(connectionUrl: string): Promise<boolean> {
    const dbType = detectDatabaseType(connectionUrl);
    
    try {
      if (dbType === 'mysql') {
        const connection = await mysql.createConnection(connectionUrl);
        await connection.execute('SELECT 1');
        await connection.end();
      } else {
        const testPool = new Pool({
          connectionString: connectionUrl,
          max: 1,
          connectionTimeoutMillis: 10000, // 10 seconds for connection test
        });
        const client = await testPool.connect();
        await client.query('SELECT 1');
        client.release();
        await testPool.end();
      }
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }

  async executeQuery(
    connectionId: string, 
    query: string, 
    params: any[] = [], 
    timeoutMs?: number // If not provided, will be auto-determined
  ): Promise<{ rows: any[], rowCount: number, executionTime: number }> {
    const poolInfo = this.pools.get(connectionId);
    if (!poolInfo) {
      // Pool not in cache, get it (which will create it)
      await this.getPool(connectionId);
      return this.executeQuery(connectionId, query, params, timeoutMs);
    }

    // Auto-determine timeout if not provided
    const timeout = timeoutMs || determineQueryTimeout(query);

    // Validate parameters for MySQL - it doesn't allow undefined values
    if (poolInfo.type === 'mysql') {
      const hasUndefined = params.some(param => param === undefined);
      if (hasUndefined) {
        throw new Error(`MySQL queries cannot contain undefined parameters. Received: ${JSON.stringify(params)}`);
      }
    }

    const startTime = Date.now();
    let isTimeout = false;
    
    try {
      // Execute the query with timeout protection using utility function
      const queryPromise = this.executeQueryInternal(poolInfo, query, params);
      const result = await withTimeout(
        queryPromise, 
        timeout, 
        `Query timed out after ${timeout}ms. Consider optimizing your query or increasing the timeout.`
      );
      
      const executionTime = Date.now() - startTime;
      
      // Log performance metrics
      const metrics = createQueryMetrics(executionTime, timeout, query, false);
      logQueryMetrics(connectionId, query, metrics);
      
      return {
        ...result,
        executionTime
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      isTimeout = error.message?.includes('timeout') || error.message?.includes('timed out');
      
      // Log performance metrics with error information
      const metrics = createQueryMetrics(executionTime, timeout, query, isTimeout);
      logQueryMetrics(connectionId, query, metrics);
      
      if (isTimeout) {
        throw new Error(`Query timed out after ${timeout}ms. Consider optimizing your query or increasing the timeout.`);
      }
      
      throw new Error(`Query failed: ${error.message}`);
    }
  }

  private async executeQueryInternal(
    poolInfo: DatabasePool, 
    query: string, 
    params: any[]
  ): Promise<{ rows: any[], rowCount: number }> {
    if (poolInfo.type === 'mysql') {
      const pool = poolInfo.pool as mysql.Pool;
      const [rows] = await pool.execute(query, params);
      
      return {
        rows: Array.isArray(rows) ? rows : [],
        rowCount: Array.isArray(rows) ? rows.length : 0
      };
    } else {
      const pool = poolInfo.pool as InstanceType<typeof Pool>;
      const result = await pool.query(query, params);
      
      return {
        rows: result.rows,
        rowCount: result.rowCount || 0
      };
    }
  }

  private async cleanupIdleConnections(): Promise<void> {
    const now = new Date();
    
    for (const [connectionId, poolInfo] of Array.from(this.pools.entries())) {
      const idleTime = now.getTime() - poolInfo.lastUsed.getTime();
      
      if (idleTime > this.maxIdleTime) {
        try {
          if (poolInfo.type === 'mysql') {
            await (poolInfo.pool as mysql.Pool).end();
          } else {
            await (poolInfo.pool as InstanceType<typeof Pool>).end();
          }
        } catch (error) {
          console.error(`Error closing pool for ${connectionId}:`, error);
        }
        
        this.pools.delete(connectionId);
        console.log(`Cleaned up idle connection: ${connectionId}`);
      }
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    const poolInfo = this.pools.get(connectionId);
    if (poolInfo) {
      if (poolInfo.type === 'mysql') {
        await (poolInfo.pool as mysql.Pool).end();
      } else {
        await (poolInfo.pool as InstanceType<typeof Pool>).end();
      }
      this.pools.delete(connectionId);
    }
  }

  async closeAllConnections(): Promise<void> {
    const closePromises = Array.from(this.pools.values()).map(async poolInfo => {
      if (poolInfo.type === 'mysql') {
        return (poolInfo.pool as mysql.Pool).end();
      } else {
        return (poolInfo.pool as InstanceType<typeof Pool>).end();
      }
    });
    
    await Promise.all(closePromises);
    this.pools.clear();
  }

  // Helper method to get database type for a connection
  async getDatabaseType(connectionId: string): Promise<DatabaseType> {
    const poolInfo = this.pools.get(connectionId);
    if (poolInfo) {
      return poolInfo.type;
    }
    
    const connection = await storage.getDatabaseConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection not found: ${connectionId}`);
    }
    
    return detectDatabaseType(connection.connectionUrl);
  }
}

export const databaseManager = new DatabaseManager();
