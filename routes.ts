import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { databaseManager } from "./services/database-manager";
import { schemaIntrospector } from "./services/schema-introspector";
import { aiQueryGenerator } from "./services/ai-query-generator";
import { groqQueryGenerator } from "./services/groq-query-generator";
import { insertDatabaseConnectionSchema, insertChatMessageSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Database connections routes
  app.get("/api/database-connections", async (req, res) => {
    try {
      const connections = await storage.getDatabaseConnections();
      console.log('Database connections:', connections);
      res.json(connections);
    } catch (error: any) {
      console.error('Error getting database connections:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/database-connections", async (req, res) => {
    try {
      const validatedData = insertDatabaseConnectionSchema.parse(req.body);
      
      // Test connection before saving
      const isValid = await databaseManager.testConnection(validatedData.connectionUrl);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid database connection URL or connection failed" });
      }

      const connection = await storage.createDatabaseConnection(validatedData);
      
      // Start schema introspection in background
      schemaIntrospector.introspectDatabase(connection.id).catch(console.error);
      
      res.json(connection);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).toString() });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Groq AI query optimization endpoint
  app.post("/api/groq/optimize-query", async (req, res) => {
    try {
      const { sqlQuery, connectionId } = req.body;
      
      if (!sqlQuery || !connectionId) {
        return res.status(400).json({ message: "sqlQuery and connectionId are required" });
      }

      const optimization = await groqQueryGenerator.optimizeQuery(sqlQuery, connectionId);
      res.json(optimization);
    } catch (error: any) {
      console.error('Groq query optimization error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Groq AI query explanation endpoint
  app.post("/api/groq/explain-query", async (req, res) => {
    try {
      const { sqlQuery, connectionId } = req.body;
      
      if (!sqlQuery || !connectionId) {
        return res.status(400).json({ message: "sqlQuery and connectionId are required" });
      }

      const explanation = await groqQueryGenerator.explainQuery(sqlQuery, connectionId);
      res.json(explanation);
    } catch (error: any) {
      console.error('Groq query explanation error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Groq AI query result summarization endpoint
  app.post("/api/groq/summarize-results", async (req, res) => {
    try {
      const { originalUserQuery, sqlQuery, queryResults, connectionId } = req.body;
      
      if (!originalUserQuery || !sqlQuery || !queryResults || !connectionId) {
        return res.status(400).json({ 
          message: "originalUserQuery, sqlQuery, queryResults, and connectionId are required" 
        });
      }

      const summarization = await groqQueryGenerator.summarizeQueryResults(
        originalUserQuery, 
        sqlQuery, 
        queryResults, 
        connectionId
      );
      res.json(summarization);
    } catch (error: any) {
      console.error('Groq query result summarization error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/database-connections/:id/activate", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.setActiveConnection(id);
      const connection = await storage.getDatabaseConnection(id);
      res.json(connection);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/database-connections/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await databaseManager.closeConnection(id);
      await storage.deleteDatabaseConnection(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Schema routes
  app.get("/api/database-connections/:id/schema", async (req, res) => {
    try {
      const { id } = req.params;
      let schema = await schemaIntrospector.getCachedSchema(id);
      
      if (!schema) {
        // Introspect if not cached
        schema = await schemaIntrospector.introspectDatabase(id);
      }
      
      res.json(schema);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/database-connections/:id/introspect", async (req, res) => {
    try {
      const { id } = req.params;
      const schema = await schemaIntrospector.introspectDatabase(id);
      res.json(schema);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Chat messages routes
  app.get("/api/database-connections/:id/messages", async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const messages = await storage.getChatMessages(id, limit);
      res.json(messages.reverse()); // Return in chronological order
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // WebSocket for real-time chat
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'chat_message') {
          await handleChatMessage(ws, message);
        } else if (message.type === 'groq_chat_message') {
          await handleGroqChatMessage(ws, message);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Failed to process message' 
        }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  async function handleChatMessage(ws: WebSocket, message: any) {
    const { connectionId, content } = message;
    
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      // Save user message
      await storage.createChatMessage({
        connectionId,
        type: 'user',
        content
      });

      // Send initial progress status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'understanding',
        message: 'Understanding your question...'
      }));

      // Brief delay to show the understanding stage
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send analyzing schema status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'analyzing',
        message: 'Analyzing database schema...'
      }));

      // Brief delay to show the analyzing stage
      await new Promise(resolve => setTimeout(resolve, 300));

      // Send generating query status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'generating',
        message: 'Generating SQL query...'
      }));

      // Generate SQL query using AI
      const queryResult = await aiQueryGenerator.generateSQLQuery(content, connectionId);
      
      // Send query generation result
      ws.send(JSON.stringify({ 
        type: 'query_generated',
        sqlQuery: queryResult.sqlQuery,
        explanation: queryResult.explanation,
        confidence: queryResult.confidence,
        warnings: queryResult.warnings
      }));

      // Send executing query status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'executing',
        message: 'Executing query...'
      }));

      // Execute the query
      const startTime = Date.now();
      const executionResult = await databaseManager.executeQuery(
        connectionId, 
        queryResult.sqlQuery
      );
      const executionTime = Date.now() - startTime;

      // Save assistant message with results
      await storage.createChatMessage({
        connectionId,
        type: 'assistant',
        content: queryResult.explanation,
        sqlQuery: queryResult.sqlQuery,
        queryResults: {
          rows: executionResult.rows,
          rowCount: executionResult.rowCount
        },
        executionTime: executionResult.executionTime
      });

      // Send final results
      ws.send(JSON.stringify({ 
        type: 'query_result',
        results: {
          rows: executionResult.rows,
          rowCount: executionResult.rowCount,
          executionTime: executionResult.executionTime
        }
      }));

      // Send completion status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'completed',
        message: 'Query completed'
      }));

    } catch (error: any) {
      console.error('Chat message handling error:', error);
      
      // Save error message
      await storage.createChatMessage({
        connectionId,
        type: 'assistant',
        content: `Error: ${error.message}`
      });

      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message 
      }));

      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'error',
        message: 'Error occurred'
      }));
    }
  }

  async function handleGroqChatMessage(ws: WebSocket, message: any) {
    const { connectionId, content } = message;
    
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      // Save user message
      await storage.createChatMessage({
        connectionId,
        type: 'user',
        content
      });

      // Send initial progress status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'understanding',
        message: 'Understanding your question with Groq...'
      }));

      // Brief delay to show the understanding stage
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send analyzing schema status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'analyzing',
        message: 'Analyzing database schema with Groq AI...'
      }));

      // Brief delay to show the analyzing stage
      await new Promise(resolve => setTimeout(resolve, 300));

      // Send generating query status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'generating',
        message: 'Generating SQL query with Groq...'
      }));

      // Generate SQL query using Groq AI
      const queryResult = await groqQueryGenerator.generateSQLQuery(content, connectionId);
      
      // Send query generation result
      ws.send(JSON.stringify({ 
        type: 'groq_query_generated',
        sqlQuery: queryResult.sqlQuery,
        explanation: queryResult.explanation,
        confidence: queryResult.confidence,
        warnings: queryResult.warnings
      }));

      // Send executing query status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'executing',
        message: 'Executing query...'
      }));

      // Execute the query
      const startTime = Date.now();
      const executionResult = await databaseManager.executeQuery(
        connectionId, 
        queryResult.sqlQuery
      );
      const executionTime = Date.now() - startTime;

      // Save assistant message with the generated query and results
      await storage.createChatMessage({
        connectionId,
        type: 'assistant',
        content: queryResult.explanation,
        sqlQuery: queryResult.sqlQuery,
        queryResults: {
          rows: executionResult.rows,
          rowCount: executionResult.rowCount
        },
        executionTime: executionResult.executionTime
      });

      // Send final results
      ws.send(JSON.stringify({ 
        type: 'groq_query_result',
        results: {
          rows: executionResult.rows,
          rowCount: executionResult.rowCount,
          executionTime: executionTime
        }
      }));

      // Send completion status
      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'completed',
        message: 'Query completed with Groq'
      }));

    } catch (error: any) {
      console.error('Groq chat message handling error:', error);
      
      // Save error message
      await storage.createChatMessage({
        connectionId,
        type: 'assistant',
        content: `Error: ${error.message}`
      });

      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error.message 
      }));

      ws.send(JSON.stringify({ 
        type: 'progress', 
        stage: 'error',
        message: 'Error occurred'
      }));
    }
  }

  return httpServer;
}
