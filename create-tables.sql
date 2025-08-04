-- Create the database tables manually
-- This is needed because drizzle-kit doesn't work with Node.js v14

-- Enable uuid extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
);

-- Create database_connections table
CREATE TABLE IF NOT EXISTS database_connections (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    connection_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create database_schemas table
CREATE TABLE IF NOT EXISTS database_schemas (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id VARCHAR NOT NULL REFERENCES database_connections(id),
    schema_data JSONB NOT NULL,
    table_count INTEGER NOT NULL,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id VARCHAR NOT NULL REFERENCES database_connections(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    sql_query TEXT,
    query_results JSONB,
    execution_time INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);