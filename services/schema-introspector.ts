import { databaseManager } from './database-manager';
import { storage } from '../storage';

export interface TableColumn {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  defaultValue: string | null;
}

export interface TableInfo {
  name: string;
  columns: TableColumn[];
  rowCount: number;
}

export interface DatabaseSchemaInfo {
  tables: TableInfo[];
  totalTables: number;
  lastIntrospected: Date;
}

export class SchemaIntrospector {
  async introspectDatabase(connectionId: string): Promise<DatabaseSchemaInfo> {
    console.log(`Starting schema introspection for connection: ${connectionId}`);
    
    const tablesQuery = `
      SELECT 
        t.table_name,
        t.table_type
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name;
    `;

    const { rows: tables } = await databaseManager.executeQuery(connectionId, tablesQuery);
    
    const tableInfos: TableInfo[] = [];
    
    for (const table of tables) {
      const tableInfo = await this.introspectTable(connectionId, table.table_name);
      tableInfos.push(tableInfo);
    }

    const schemaInfo: DatabaseSchemaInfo = {
      tables: tableInfos,
      totalTables: tableInfos.length,
      lastIntrospected: new Date()
    };

    // Cache the schema information
    await storage.saveDatabaseSchema(connectionId, schemaInfo, tableInfos.length);
    
    return schemaInfo;
  }

  private async introspectTable(connectionId: string, tableName: string): Promise<TableInfo> {
    const columnsQuery = `
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        INNER JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_name = $1
      AND c.table_schema = 'public'
      ORDER BY c.ordinal_position;
    `;

    const { rows: columns } = await databaseManager.executeQuery(connectionId, columnsQuery, [tableName]);
    
    // Get row count
    const countQuery = `SELECT COUNT(*) as count FROM "${tableName}";`;
    const { rows: countResult } = await databaseManager.executeQuery(connectionId, countQuery);
    const rowCount = parseInt(countResult[0]?.count || '0');

    const tableColumns: TableColumn[] = columns.map(col => ({
      name: col.column_name,
      type: col.data_type,
      isPrimaryKey: col.is_primary_key,
      isNullable: col.is_nullable === 'YES',
      defaultValue: col.column_default
    }));

    return {
      name: tableName,
      columns: tableColumns,
      rowCount
    };
  }

  async getCachedSchema(connectionId: string): Promise<DatabaseSchemaInfo | null> {
    const cached = await storage.getDatabaseSchema(connectionId);
    if (!cached) return null;
    
    return cached.schemaData as DatabaseSchemaInfo;
  }

  async getTableSchema(connectionId: string, tableName: string): Promise<TableInfo | null> {
    const schema = await this.getCachedSchema(connectionId);
    if (!schema) return null;
    
    return schema.tables.find(t => t.name === tableName) || null;
  }
}

export const schemaIntrospector = new SchemaIntrospector();
