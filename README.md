# Identity Reconciliation

A backend service that deduplicates customer contact information across orders using a primary-secondary contact model.

Repo: `https://github.com/NYN-05/Gray_Mobility_TASK_1`

## How it works

Every POST /identify request follows this decision flow to link contacts:

```
Receive { email, phoneNumber }
        │
        ▼
Query database WHERE email OR phone matches
        │
        ├── No match → Create PRIMARY contact, return
        │
        └── Match found
                │
                ├── One identity group, new info?
                │   → Create SECONDARY contact under the primary
                │
                ├── Two+ identity groups connected?
                │   → Merge: demote newer primaries → secondary,
                │     repoint all their secondaries to the oldest primary
                │
                └── No new info → Return existing consolidated group
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

## Setup

### Prerequisites

- Node.js v18+
- PostgreSQL 14+ running locally
- npm

### 1. Clone and install

```bash
git clone https://github.com/NYN-05/Gray_Mobility_TASK_1.git
cd Gray_Mobility_TASK_1
npm install
```

### 2. Configure database

Create a PostgreSQL database and update `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/identity_reconciliation"
PORT=3000
```

### 3. Run migrations

```bash
npx prisma migrate dev --name init
```

### 4. Build and start

```bash
npm run build
npm start
```

Server runs at `http://localhost:3000`.

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

**Error (400) — both fields missing:**

```json
{
  "error": "email or phoneNumber is required"
}
```

## Testing

```bash
npm test
```

9 test cases covering:
- Primary contact creation (no matches)
- Secondary creation (new email or phone)
- No-op when all info already exists
- Merging two primary groups
- Repointing secondaries during merge
- Validation (missing fields)
- Partial input (email only, phone only)

## Database Schema

```
Contact
  id              Int        (PK, auto-increment)
  phoneNumber     String?    (nullable)
  email           String?    (nullable)
  linkedId        Int?       (FK → Contact.id, nullable)
  linkPrecedence  String     ("primary" | "secondary")
  createdAt       DateTime
  updatedAt       DateTime
  deletedAt       DateTime?  (nullable, soft-delete)
```
