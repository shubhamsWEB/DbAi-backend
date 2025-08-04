export type DatabaseType = 'postgresql' | 'mysql';

/**
 * Detects the database type from a connection URL
 */
export function detectDatabaseType(connectionUrl: string): DatabaseType {
  const url = connectionUrl.toLowerCase();
  
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) {
    return 'mysql';
  }
  
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql';
  }
  
  // Default to PostgreSQL for backward compatibility
  return 'postgresql';
}

/**
 * Validates if a connection URL is supported
 */
export function validateDatabaseUrl(connectionUrl: string): boolean {
  try {
    const url = new URL(connectionUrl);
    const protocol = url.protocol.slice(0, -1); // Remove trailing ':'
    
    return ['mysql', 'mysql2', 'postgresql', 'postgres'].includes(protocol);
  } catch {
    return false;
  }
}

/**
 * Gets database-specific SQL syntax helpers
 */
export function getDatabaseQuoting(dbType: DatabaseType): {
  identifier: (name: string) => string;
  parameterPlaceholder: (index: number) => string;
} {
  if (dbType === 'mysql') {
    return {
      identifier: (name: string) => `\`${name}\``,
      parameterPlaceholder: (index: number) => '?'
    };
  } else {
    return {
      identifier: (name: string) => `"${name}"`,
      parameterPlaceholder: (index: number) => `$${index + 1}`
    };
  }
}