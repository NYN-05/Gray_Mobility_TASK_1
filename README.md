# Identity Reconciliation

A backend service that deduplicates customer contact information across orders. Built for the Bitespeed Backend Assignment.

## How it works

When a customer places orders using different emails or phone numbers, this service links them to a single contact profile using a primary-secondary contact model.

### Decision flow

```
Receive email + phone
        │
        ▼
Search database by email OR phone
        │
        ├── No match? → Create PRIMARY contact
        │
        └── Match found?
                │
                ├── One group, new info? → Create SECONDARY contact
                │
                ├── Two+ primary groups? → Merge (demote newer → secondary)
                │
                └── Return consolidated contact
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime   | Node.js |
| Framework | Express.js |
| Language  | TypeScript |
| Database  | PostgreSQL |
| ORM       | Prisma |
| Testing   | Jest + Supertest |

## Prerequisites

- **Node.js** v18+
- **PostgreSQL** 14+ running locally
- **npm**

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd identity-reconciliation
npm install
```

### 2. Configure database

Update `.env` with your PostgreSQL connection string:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/identity_reconciliation"
PORT=3000
```

### 3. Create database and run migrations

```bash
createdb identity_reconciliation
npx prisma migrate dev --name init
```

### 4. Build and start

```bash
npm run build
npm start
```

Server starts on `http://localhost:3000`.

## API

### POST /identify

**Request:**

```json
{
  "email": "doc@example.com",
  "phoneNumber": "9999999999"
}
```

**Response (200):**

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["doc@example.com", "doctor@gmail.com"],
    "phoneNumbers": ["9999999999", "8888888888"],
    "secondaryContactIds": [3, 4]
  }
}
```

## Testing

```bash
npm test
```

Runs 9 test cases covering:
- Primary contact creation (no matches)
- Secondary contact creation (new email or phone)
- No-op when all info already exists
- Merging two primary groups
- Repointing secondaries during merge
- Validation (missing fields)
- Partial input (email only, phone only)

## Database Schema

```
Contact
  id              Int          (PK, auto-increment)
  phoneNumber     String?      (nullable)
  email           String?      (nullable)
  linkedId        Int?         (FK to primary contact, nullable)
  linkPrecedence  String       ("primary" | "secondary")
  createdAt       DateTime
  updatedAt       DateTime
  deletedAt       DateTime?    (nullable, soft-delete)
```
