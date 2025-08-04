/**
 * Utility functions for handling database query timeouts and performance optimization
 */

export interface QueryMetrics {
  executionTime: number;
  timeout: number;
  isTimeout: boolean;
  queryType: string;
}

export interface TimeoutConfig {
  default: number;
  simple: number;
  complex: number;
  ddl: number;
  longRunning: number;
}

// Default timeout configuration (in milliseconds)
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  default: 120000,    // 2 minutes for default queries
  simple: 300000,     // 5 minutes for simple SELECT queries
  complex: 900000,    // 15 minutes for complex queries with JOINs, GROUP BY, etc.
  ddl: 1800000,       // 30 minutes for DDL operations (CREATE INDEX, ALTER TABLE)
  longRunning: 3600000 // 1 hour for analytics/reporting queries
};

/**
 * Analyzes a SQL query and determines appropriate timeout
 */
export function determineQueryTimeout(
  sqlQuery: string, 
  config: TimeoutConfig = DEFAULT_TIMEOUT_CONFIG
): number {
  const query = sqlQuery.toLowerCase().trim();
  
  // DDL operations - typically need longer timeouts
  if (isDDLQuery(query)) {
    return config.ddl;
  }
  
  // Analytics/reporting queries - can be very slow
  if (isAnalyticsQuery(query)) {
    return config.longRunning;
  }
  
  // Complex SELECT queries
  if (isComplexQuery(query)) {
    return config.complex;
  }
  
  // Simple SELECT queries
  if (isSimpleSelectQuery(query)) {
    return config.simple;
  }
  
  // Default timeout for other operations
  return config.default;
}

/**
 * Checks if query is a DDL operation
 */
function isDDLQuery(query: string): boolean {
  const ddlKeywords = [
    'create index',
    'drop index',
    'alter table',
    'create table',
    'drop table',
    'vacuum',
    'reindex',
    'analyze'
  ];
  
  return ddlKeywords.some(keyword => query.includes(keyword));
}

/**
 * Checks if query is an analytics/reporting query
 */
function isAnalyticsQuery(query: string): boolean {
  const analyticsIndicators = [
    'count(*)',
    'sum(',
    'avg(',
    'max(',
    'min(',
    'stddev(',
    'variance('
  ];
  
  const hasAggregation = analyticsIndicators.some(indicator => query.includes(indicator));
  const hasGroupBy = query.includes('group by');
  const hasMultipleJoins = (query.match(/join/g) || []).length > 2;
  
  return hasAggregation && (hasGroupBy || hasMultipleJoins);
}

/**
 * Checks if query is complex (JOINs, subqueries, etc.)
 */
function isComplexQuery(query: string): boolean {
  const complexIndicators = [
    'join',
    'union',
    'group by',
    'order by',
    'having',
    'distinct',
    'exists',
    'not exists',
    'in (',
    'not in (',
    'case when',
    'window',
    'over (',
    'with '
  ];
  
  return complexIndicators.some(indicator => query.includes(indicator));
}

/**
 * Checks if query is a simple SELECT
 */
function isSimpleSelectQuery(query: string): boolean {
  return query.startsWith('select') && 
         !isComplexQuery(query) && 
         !isAnalyticsQuery(query);
}

/**
 * Wraps a promise with a timeout
 */
export function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  timeoutMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Creates query performance metrics
 */
export function createQueryMetrics(
  executionTime: number,
  timeout: number,
  sqlQuery: string,
  isTimeout: boolean = false
): QueryMetrics {
  return {
    executionTime,
    timeout,
    isTimeout,
    queryType: getQueryType(sqlQuery)
  };
}

/**
 * Determines the type of SQL query
 */
function getQueryType(sqlQuery: string): string {
  const query = sqlQuery.toLowerCase().trim();
  
  if (query.startsWith('select')) return 'SELECT';
  if (query.startsWith('insert')) return 'INSERT';
  if (query.startsWith('update')) return 'UPDATE';
  if (query.startsWith('delete')) return 'DELETE';
  if (query.startsWith('create')) return 'CREATE';
  if (query.startsWith('alter')) return 'ALTER';
  if (query.startsWith('drop')) return 'DROP';
  if (query.startsWith('truncate')) return 'TRUNCATE';
  
  return 'OTHER';
}

/**
 * Provides suggestions for optimizing slow queries
 */
export function getQueryOptimizationSuggestions(metrics: QueryMetrics): string[] {
  const suggestions: string[] = [];
  
  if (metrics.isTimeout) {
    suggestions.push('Query timed out. Consider adding WHERE clauses to limit result set.');
    suggestions.push('Check if appropriate indexes exist for your WHERE and JOIN conditions.');
  }
  
  if (metrics.executionTime > 10000) { // More than 10 seconds
    suggestions.push('Query is running slowly. Consider optimizing with indexes.');
    
    if (metrics.queryType === 'SELECT') {
      suggestions.push('For SELECT queries, ensure you\'re not selecting unnecessary columns.');
      suggestions.push('Consider using LIMIT to reduce result set size.');
    }
  }
  
  if (metrics.executionTime > metrics.timeout * 0.8) {
    suggestions.push('Query is approaching timeout limit. Consider optimization.');
  }
  
  return suggestions;
}

/**
 * Logs query performance metrics
 */
export function logQueryMetrics(
  connectionId: string,
  sqlQuery: string,
  metrics: QueryMetrics
): void {
  const logLevel = metrics.isTimeout ? 'ERROR' : 
                  metrics.executionTime > 5000 ? 'WARN' : 'INFO';
  
  const message = [
    `[${logLevel}] Query ${metrics.queryType}`,
    `Connection: ${connectionId}`,
    `Execution time: ${metrics.executionTime}ms`,
    `Timeout: ${metrics.timeout}ms`,
    metrics.isTimeout ? 'TIMED OUT' : 'COMPLETED'
  ].join(' | ');
  
  if (logLevel === 'ERROR') {
    console.error(message);
    console.error('Query:', sqlQuery);
  } else if (logLevel === 'WARN') {
    console.warn(message);
  } else {
    console.log(message);
  }
  
  // Log optimization suggestions for slow queries
  if (metrics.executionTime > 5000 || metrics.isTimeout) {
    const suggestions = getQueryOptimizationSuggestions(metrics);
    if (suggestions.length > 0) {
      console.log('Optimization suggestions:');
      suggestions.forEach(suggestion => console.log(`  - ${suggestion}`));
    }
  }
}