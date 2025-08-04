# Schema Query Bot - Backend

Express.js API server for the Schema Query Bot.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp env.example .env
```

3. Update `.env` with your database connection and other settings

4. Push database schema:
```bash
npm run db:push
```

## Development

Start the development server:
```bash
npm run dev
```

The API server will be available at http://localhost:5000

## Build

Build for production:
```bash
npm run build
npm start
```

## Features

- RESTful API endpoints
- Database connection management
- Schema introspection
- AI query generation (OpenAI/Groq)
- WebSocket support
- PostgreSQL with Drizzle ORM
- Express.js with TypeScript
- CORS enabled for frontend communication

## API Endpoints

- `GET /api/databases` - List database connections
- `POST /api/databases` - Create database connection
- `GET /api/databases/:id/schema` - Get database schema
- `POST /api/chat` - AI chat for query generation
- `POST /api/query` - Execute database queries