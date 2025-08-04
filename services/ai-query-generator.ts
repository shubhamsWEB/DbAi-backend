import OpenAI from "openai";
import { schemaIntrospector, type DatabaseSchemaInfo } from './schema-introspector';

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

export interface QueryResult {
  sqlQuery: string;
  explanation: string;
  confidence: number;
  warnings?: string[];
}

export class AIQueryGenerator {
  async generateSQLQuery(userQuestion: string, connectionId: string): Promise<QueryResult> {
    const schema = await schemaIntrospector.getCachedSchema(connectionId);
    if (!schema) {
      throw new Error('Database schema not available. Please introspect the database first.');
    }

    const schemaDescription = this.buildSchemaDescription(schema);
    
    const prompt = `You are an expert PostgreSQL query generator. Given a database schema and a user question, generate an accurate SQL query.

DATABASE SCHEMA:
${schemaDescription}

USER QUESTION: ${userQuestion}

Generate a PostgreSQL query that answers the user's question. Consider:
1. Use proper JOIN syntax when relationships are needed
2. Include appropriate WHERE clauses for filtering
3. Use aggregate functions when summarizing data
4. Add ORDER BY clauses for better result organization
5. Limit results if the query might return too many rows (use LIMIT)
6. Use proper column aliases for readability

Respond with JSON in this format:
{
  "sqlQuery": "SELECT ...",
  "explanation": "This query does...",
  "confidence": 0.95,
  "warnings": ["Optional array of warnings about the query"]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert SQL query generator. Always respond with valid JSON containing sqlQuery, explanation, confidence, and optional warnings fields."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1, // Low temperature for more consistent SQL generation
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        sqlQuery: result.sqlQuery || '',
        explanation: result.explanation || '',
        confidence: Math.max(0, Math.min(1, result.confidence || 0)),
        warnings: result.warnings || []
      };
    } catch (error: any) {
      console.error('AI query generation failed:', error);
      throw new Error(`Failed to generate SQL query: ${error.message}`);
    }
  }

  private buildSchemaDescription(schema: DatabaseSchemaInfo): string {
    let description = `Database contains ${schema.totalTables} tables:\n\n`;
    
    for (const table of schema.tables) {
      description += `TABLE: ${table.name} (${table.rowCount} rows)\n`;
      
      for (const column of table.columns) {
        const constraints = [];
        if (column.isPrimaryKey) constraints.push('PRIMARY KEY');
        if (!column.isNullable) constraints.push('NOT NULL');
        if (column.defaultValue) constraints.push(`DEFAULT ${column.defaultValue}`);
        
        const constraintStr = constraints.length > 0 ? ` (${constraints.join(', ')})` : '';
        description += `  - ${column.name}: ${column.type}${constraintStr}\n`;
      }
      description += '\n';
    }
    
    return description;
  }

  async optimizeQuery(originalQuery: string, connectionId: string): Promise<{ optimizedQuery: string; improvements: string[] }> {
    const schema = await schemaIntrospector.getCachedSchema(connectionId);
    if (!schema) {
      return { optimizedQuery: originalQuery, improvements: [] };
    }

    const prompt = `Analyze and optimize this PostgreSQL query for better performance:

QUERY:
${originalQuery}

SCHEMA:
${this.buildSchemaDescription(schema)}

Suggest optimizations like:
1. Adding proper indexes (mention in improvements)
2. Rewriting joins for better performance
3. Using EXISTS instead of IN where appropriate
4. Optimizing WHERE clauses
5. Adding LIMIT if missing and appropriate

Respond with JSON:
{
  "optimizedQuery": "optimized SQL query",
  "improvements": ["list of improvements made"]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a PostgreSQL performance optimization expert. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        optimizedQuery: result.optimizedQuery || originalQuery,
        improvements: result.improvements || []
      };
    } catch (error) {
      console.error('Query optimization failed:', error);
      return { optimizedQuery: originalQuery, improvements: [] };
    }
  }
}

export const aiQueryGenerator = new AIQueryGenerator();
