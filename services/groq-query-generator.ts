import Groq from "groq-sdk";
import { schemaIntrospector, type DatabaseSchemaInfo } from './schema-introspector';

// Initialize Groq client with the provided API key
const groq = new Groq({ 
  apiKey: process.env.GROQ_API_KEY 
});

export interface GroqQueryResult {
  sqlQuery: string;
  explanation: string;
  confidence: number;
  warnings?: string[];
}

export class GroqQueryGenerator {
  async generateSQLQuery(userQuestion: string, connectionId: string): Promise<GroqQueryResult> {
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
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
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
      console.error('Groq query generation failed:', error);
      throw new Error(`Failed to generate SQL query with Groq: ${error.message}`);
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
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
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
      console.error('Groq query optimization failed:', error);
      return { optimizedQuery: originalQuery, improvements: [] };
    }
  }

  async explainQuery(sqlQuery: string, connectionId: string): Promise<{ explanation: string; complexity: string; performance_tips: string[] }> {
    const schema = await schemaIntrospector.getCachedSchema(connectionId);
    if (!schema) {
      throw new Error('Database schema not available. Please introspect the database first.');
    }

    const prompt = `Analyze and explain this PostgreSQL query in detail:

QUERY:
${sqlQuery}

SCHEMA:
${this.buildSchemaDescription(schema)}

Provide a detailed explanation including:
1. What the query does step by step
2. Which tables and columns are involved
3. Performance characteristics and complexity
4. Potential performance improvements

Respond with JSON:
{
  "explanation": "Detailed step-by-step explanation of what the query does",
  "complexity": "LOW/MEDIUM/HIGH",
  "performance_tips": ["list of performance tips"]
}`;

    try {
      const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "You are a PostgreSQL expert who explains queries clearly and provides performance insights. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        explanation: result.explanation || 'No explanation available',
        complexity: result.complexity || 'UNKNOWN',
        performance_tips: result.performance_tips || []
      };
    } catch (error: any) {
      console.error('Groq query explanation failed:', error);
      throw new Error(`Failed to explain query with Groq: ${error.message}`);
    }
  }

  async summarizeQueryResults(
    originalUserQuery: string, 
    sqlQuery: string, 
    queryResults: { rows: any[]; rowCount: number }, 
    connectionId: string
  ): Promise<{ summary: string; insights: string[] }> {
    const schema = await schemaIntrospector.getCachedSchema(connectionId);
    const schemaDescription = schema ? this.buildSchemaDescription(schema) : 'Schema not available';

    // Convert query results to a readable format
    const resultsText = this.formatQueryResultsForSummarization(queryResults);
    
    const prompt = `You are an expert data analyst. Analyze the SQL query results and provide a natural language summary based on the user's original question.

USER'S ORIGINAL QUESTION: ${originalUserQuery}

SQL QUERY EXECUTED:
${sqlQuery}

DATABASE SCHEMA:
${schemaDescription}

QUERY RESULTS:
${resultsText}

Please provide a comprehensive analysis that includes:
1. A natural language summary answering the user's question
2. Key insights and patterns from the data
3. Notable trends or anomalies
4. Practical implications of the findings

Respond with JSON in this format:
{
  "summary": "A clear, natural language answer to the user's question based on the data",
  "insights": ["Key insight 1", "Key insight 2", "Key insight 3"]
}`;

    try {
      const response = await groq.chat.completions.create({
        model: "moonshotai/kimi-k2-instruct", // Using Kimi K2 for largest context window (131K tokens)
        messages: [
          {
            role: "system",
            content: "You are an expert data analyst who summarizes SQL query results into clear, actionable insights. Always respond with valid JSON containing summary and insights fields."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // Slightly higher temperature for more creative insights
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        summary: result.summary || 'Unable to generate summary',
        insights: result.insights || []
      };
    } catch (error: any) {
      console.error('Groq summarization failed:', error);
      throw new Error(`Failed to summarize query results with Groq: ${error.message}`);
    }
  }

  private formatQueryResultsForSummarization(queryResults: { rows: any[]; rowCount: number }): string {
    const { rows, rowCount } = queryResults;
    
    if (rowCount === 0) {
      return "No data returned from the query.";
    }

    // Include header information
    let resultsText = `Total rows returned: ${rowCount}\n\n`;
    
    if (rows.length > 0) {
      // Get column names from the first row
      const columns = Object.keys(rows[0]);
      resultsText += `Columns: ${columns.join(', ')}\n\n`;
      
      // Include sample data (limit to first 10 rows for context window efficiency)
      const sampleRows = rows.slice(0, Math.min(10, rows.length));
      resultsText += "Sample data:\n";
      
      sampleRows.forEach((row, index) => {
        resultsText += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
      });
      
      if (rows.length > 10) {
        resultsText += `... and ${rows.length - 10} more rows\n`;
      }
      
      // Add basic statistics if we have numeric data
      resultsText += this.generateBasicStatistics(rows, columns);
    }
    
    return resultsText;
  }

  private generateBasicStatistics(rows: any[], columns: string[]): string {
    let statsText = "\nBasic statistics:\n";
    
    columns.forEach(column => {
      const values = rows.map(row => row[column]).filter(val => val !== null && val !== undefined);
      
      if (values.length === 0) return;
      
      // Check if column contains numeric data
      const numericValues = values.filter(val => typeof val === 'number' || !isNaN(Number(val)));
      
      if (numericValues.length > 0) {
        const numbers = numericValues.map(val => Number(val));
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = sum / numbers.length;
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        
        statsText += `${column}: min=${min}, max=${max}, avg=${avg.toFixed(2)}\n`;
      } else {
        // For non-numeric data, show unique count
        const uniqueValues = Array.from(new Set(values));
        statsText += `${column}: ${uniqueValues.length} unique values\n`;
      }
    });
    
    return statsText;
  }
}

export const groqQueryGenerator = new GroqQueryGenerator();