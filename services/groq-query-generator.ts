import Groq from "groq-sdk";
import { schemaIntrospector, type DatabaseSchemaInfo } from './schema-introspector';
import { databaseManager } from './database-manager';

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

    const dbType = await databaseManager.getDatabaseType(connectionId);
    const dbName = dbType === 'mysql' ? 'MySQL' : 'PostgreSQL';
    const quotingStyle = dbType === 'mysql' ? 'backticks (`)' : 'double quotes (")';

    const schemaDescription = this.buildSchemaDescription(schema);
    
    const prompt = `You are an expert ${dbName} query generator. Given a database schema and a user question, generate an accurate SQL query.

DATABASE SCHEMA:
${schemaDescription}

USER QUESTION: ${userQuestion}

Generate a ${dbName} query that answers the user's question. Consider:
1. Use proper JOIN syntax when relationships are needed
2. Include appropriate WHERE clauses for filtering
3. Use aggregate functions when summarizing data
4. Add ORDER BY clauses for better result organization
5. Limit results if the query might return too many rows (use LIMIT)
6. Use proper column aliases for readability
7. Use ${quotingStyle} for table/column names with spaces or reserved words

Respond with JSON in this format:
{
  "sqlQuery": "SELECT ...",
  "explanation": "This query does...",
  "confidence": 0.95,
  "warnings": ["Optional array of warnings about the query"]
}`;

    try {
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile", // Higher context window and better performance
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
    let description = `Database: ${schema.totalTables} tables\n\n`;
    
    for (const table of schema.tables) {
      description += `${table.name}(${table.rowCount}):\n`;
      
      // Group columns by type to reduce verbosity
      const pkColumns = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
      const regularColumns = table.columns.filter(c => !c.isPrimaryKey);
      
      if (pkColumns.length > 0) {
        description += `  PK: ${pkColumns.join(', ')}\n`;
      }
      
      // Simplified column description - only essential info
      for (const column of regularColumns.slice(0, 10)) { // Limit to first 10 columns
        const nullInfo = column.isNullable ? '' : ' NOT NULL';
        description += `  ${column.name}: ${column.type}${nullInfo}\n`;
      }
      
      if (regularColumns.length > 10) {
        description += `  ... and ${regularColumns.length - 10} more columns\n`;
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

    const dbType = await databaseManager.getDatabaseType(connectionId);
    const dbName = dbType === 'mysql' ? 'MySQL' : 'PostgreSQL';

    const prompt = `Analyze and optimize this ${dbName} query for better performance:

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
            content: `You are a ${dbName} performance optimization expert. Always respond with valid JSON.`
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

    const dbType = await databaseManager.getDatabaseType(connectionId);
    const dbName = dbType === 'mysql' ? 'MySQL' : 'PostgreSQL';

    const prompt = `Analyze and explain this ${dbName} query in detail:

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
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `You are a ${dbName} expert who explains queries clearly and provides performance insights. Always respond with valid JSON.`
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
    
    // Build the prompt with intelligent truncation to stay within token limits
    const { truncatedPrompt } = this.buildTruncatedSummarizationPrompt(
      originalUserQuery,
      sqlQuery,
      queryResults,
      schema
    );
    
    try {
      const response = await groq.chat.completions.create({
        model: "moonshotai/kimi-k2-instruct", // Better performance and higher context window
        messages: [
          {
            role: "system",
            content: "You are an expert data analyst who summarizes SQL query results into clear, actionable insights. Always respond with valid JSON containing summary and insights fields."
          },
          {
            role: "user",
            content: truncatedPrompt
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

  private buildTruncatedSummarizationPrompt(
    originalUserQuery: string,
    sqlQuery: string,
    queryResults: { rows: any[]; rowCount: number },
    schema: DatabaseSchemaInfo | null
  ): { truncatedPrompt: string; tokenEstimate: number } {
    // Target token limit with safety margin (aim for ~8500 to leave room for system message and response)
    const TARGET_TOKEN_LIMIT = 8500;
    
    // Rough estimation: 1 token ≈ 4 characters
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    
    // Build base prompt structure
    const basePrompt = `You are an expert data analyst. Analyze the SQL query results and provide a natural language summary based on the user's original question.

USER'S ORIGINAL QUESTION: ${originalUserQuery}

SQL QUERY EXECUTED:
${sqlQuery}

DATABASE SCHEMA:
{SCHEMA_PLACEHOLDER}

QUERY RESULTS:
{RESULTS_PLACEHOLDER}

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

    // Calculate base tokens (everything except schema and results)
    const baseTokens = estimateTokens(basePrompt.replace('{SCHEMA_PLACEHOLDER}', '').replace('{RESULTS_PLACEHOLDER}', ''));
    let remainingTokens = TARGET_TOKEN_LIMIT - baseTokens;
    
    // Generate schema description with progressive truncation
    let schemaDescription = 'Schema not available';
    if (schema) {
      schemaDescription = this.buildTruncatedSchemaDescription(schema, Math.floor(remainingTokens * 0.3)); // Allocate 30% to schema
    }
    
    // Calculate remaining tokens after schema
    const schemaTokens = estimateTokens(schemaDescription);
    remainingTokens = remainingTokens - schemaTokens;
    
    // Generate results text with remaining tokens
    const resultsText = this.formatQueryResultsForSummarizationWithLimit(queryResults, remainingTokens);
    
    // Build final prompt
    const finalPrompt = basePrompt
      .replace('{SCHEMA_PLACEHOLDER}', schemaDescription)
      .replace('{RESULTS_PLACEHOLDER}', resultsText);
    
    const finalTokenEstimate = estimateTokens(finalPrompt);
    
    return {
      truncatedPrompt: finalPrompt,
      tokenEstimate: finalTokenEstimate
    };
  }

  private buildTruncatedSchemaDescription(schema: DatabaseSchemaInfo, maxTokens: number): string {
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    
    let description = `Database: ${schema.totalTables} tables\n\n`;
    let currentTokens = estimateTokens(description);
    
    // Sort tables by row count (prioritize tables with more data)
    const sortedTables = [...schema.tables].sort((a, b) => (b.rowCount || 0) - (a.rowCount || 0));
    
    for (let i = 0; i < sortedTables.length; i++) {
      const table = sortedTables[i];
      
      // Build table description progressively
      let tableDesc = `${table.name}(${table.rowCount}):\n`;
      
      // Add primary keys
      const pkColumns = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
      if (pkColumns.length > 0) {
        tableDesc += `  PK: ${pkColumns.join(', ')}\n`;
      }
      
      // Add regular columns (limit based on remaining tokens)
      const regularColumns = table.columns.filter(c => !c.isPrimaryKey);
      const tokensForTable = Math.floor((maxTokens - currentTokens) / (sortedTables.length - i));
      
      let columnsAdded = 0;
      const maxColumns = Math.min(regularColumns.length, Math.max(3, Math.floor(tokensForTable / 10))); // At least 3 columns if possible
      
      for (const column of regularColumns.slice(0, maxColumns)) {
        const columnDesc = `  ${column.name}: ${column.type}${column.isNullable ? '' : ' NOT NULL'}\n`;
        if (estimateTokens(tableDesc + columnDesc) + currentTokens > maxTokens) break;
        
        tableDesc += columnDesc;
        columnsAdded++;
      }
      
      if (regularColumns.length > columnsAdded) {
        tableDesc += `  ... and ${regularColumns.length - columnsAdded} more columns\n`;
      }
      
      tableDesc += '\n';
      
      // Check if adding this table would exceed token limit
      if (currentTokens + estimateTokens(tableDesc) > maxTokens) {
        const remainingTables = sortedTables.length - i;
        if (remainingTables > 0) {
          description += `... and ${remainingTables} more tables\n`;
        }
        break;
      }
      
      description += tableDesc;
      currentTokens += estimateTokens(tableDesc);
    }
    
    return description;
  }

  private formatQueryResultsForSummarizationWithLimit(
    queryResults: { rows: any[]; rowCount: number },
    maxTokens: number
  ): string {
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const { rows, rowCount } = queryResults;
    
    if (rowCount === 0) {
      return "No data returned from the query.";
    }

    let resultsText = `Total rows returned: ${rowCount}\n\n`;
    let currentTokens = estimateTokens(resultsText);
    
    if (rows.length > 0) {
      // Add column information
      const columns = Object.keys(rows[0]);
      const columnsText = `Columns: ${columns.join(', ')}\n\n`;
      
      if (currentTokens + estimateTokens(columnsText) < maxTokens) {
        resultsText += columnsText;
        currentTokens += estimateTokens(columnsText);
      }
      
      // Add sample data with dynamic row limiting based on available tokens
      resultsText += "Sample data:\n";
      currentTokens += estimateTokens("Sample data:\n");
      
      let rowsAdded = 0;
      const maxRows = Math.min(rows.length, 5); // Start with max 5 rows, reduce if needed
      
      for (let i = 0; i < maxRows; i++) {
        const rowText = `Row ${i + 1}: ${JSON.stringify(rows[i])}\n`;
        const rowTokens = estimateTokens(rowText);
        
        if (currentTokens + rowTokens > maxTokens * 0.8) { // Use 80% of remaining space for data
          break;
        }
        
        resultsText += rowText;
        currentTokens += rowTokens;
        rowsAdded++;
      }
      
      if (rows.length > rowsAdded) {
        resultsText += `... and ${rows.length - rowsAdded} more rows\n`;
      }
      
      // Add basic statistics if there's still room
      const statsText = this.generateBasicStatistics(rows, columns);
      if (currentTokens + estimateTokens(statsText) < maxTokens) {
        resultsText += statsText;
      }
    }
    
    return resultsText;
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