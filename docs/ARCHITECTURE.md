# Architecture & System Design Document
## Recruitment Candidate Management & AI Search Platform

**Author:** Ayush Kumar &bull; [LinkedIn Profile](https://www.linkedin.com/in/ayush-kumar-7b5888241/)  
**GitHub Repository:** [https://github.com/ayushprajapati3002/RecruitmentSoftware](https://github.com/ayushprajapati3002/RecruitmentSoftware)  
**Live Frontend:** [https://recruitment-software-joq491vti-ayush-kumars-projects-8e4c77e0.vercel.app/](https://recruitment-software-joq491vti-ayush-kumars-projects-8e4c77e0.vercel.app/)  
**Live Backend API:** [https://recruitment-backend-iotr.onrender.com/api/candidates](https://recruitment-backend-iotr.onrender.com/api/candidates)  

---

## 1. Executive Summary
The **Recruitment Candidate Management System** is a full-stack platform designed to streamline hiring workflows, candidate progression tracking, and natural-language pipeline querying. Built with a modern architecture using React 19, Node.js (Express 5), PostgreSQL via Prisma, and Groq-accelerated AI, the application provides instantaneous candidate stage transitions, audit trail immutability, and natural language recruiter search with PostgreSQL `pg_trgm` fuzzy matching.

---

## 2. High-Level Architecture

```
+-------------------------------------------------------------------------+
|                              CLIENT LAYER                               |
|                  React 19 + TypeScript + Vite                           |
|        - Candidate Pipeline Board & Stage Progression (Kanban & List)   |
|        - Optimistic UI updates with instantaneous stage transitions     |
|        - Natural Language Search Bar with Query Parsing Diagnostics     |
|        - Dynamic contextual suggestions pills & phone contact displays  |
+------------------------------------+------------------------------------+
                                     | HTTP REST (JSON)
                                     v
+-------------------------------------------------------------------------+
|                               API LAYER                                 |
|                       Express 5 on Node.js v24                          |
|   /api/candidates           /api/search               /uploads          |
|   - CRUD Candidate Data     - NLP Search Controller   - Static Resumes  |
|   - Stage Advance/Reject    - Groq SDK Interface                        |
|   - CORS with credentials   - Relaxed Text Fallback                     |
+-------------------+--------------------------------+--------------------+
                    |                                |
       Raw SQL /    |                                | Structured
       Prisma ORM   |                                | Prompt / JSON
                    v                                v
+---------------------------------+  +------------------------------------+
|         DATABASE LAYER          |  |             AI LAYER               |
|  PostgreSQL Database (Supabase) |  |             Groq Cloud             |
|  - candidates (pg_trgm indexed) |  | - Intent Interpretation            |
|  - candidate_history (Immutable)|  | - Structured JSON Search Plan      |
|  - Soft-delete flag (isArchived)|  | - Valid application stages injected|
|  - Weighted Relevance Scoring   |  | - Contextual follow-up suggestions |
+---------------------------------+  +------------------------------------+
```

---

## 3. Core Architectural Modules

### 3.1. Frontend Architecture (React 19 & TypeScript)
- **State Flow & Optimistic UI**: Centralized reactive state in `App.tsx` handles candidate selection, search filters, and stage movements. When advancing or rejecting candidates, the UI updates optimistically with 0ms perceived lag, syncing with the server in the background.
- **Responsiveness**: Pure Vanilla CSS implementation avoiding heavy utility libraries. Utilizes CSS Grid and Flexbox with granular breakpoints to support mobile viewports, dual-screen foldables, and wide desktop dashboards.
- **Phone & Contact Visibility**: Instant phone number display across Kanban cards, List cards, and candidate detail modals.

### 3.2. Backend & API Services (Express 5)
- **Controller-Service Pattern**: Clear separation of HTTP concerns (`candidateController`, `searchController`) from business logic and query extraction (`nlpService`, `searchService`).
- **CORS & Express 5 Compatibility**: Configured with explicit origin credentials and method permissions, fully compatible with Express 5 route parsers.
- **File Ingestion**: Multer-backed storage with unique timestamped file hashing for candidate resumes with direct file download capabilities.

### 3.3. Database Architecture (PostgreSQL & Prisma)
- **`candidates` Model**: Stores all core candidate metadata (contact, phoneNorm, skills array, vacancy, resume URL, experience, current stage, soft delete state).
- **`candidate_history` Model**: An append-only audit log tracking every candidate status transition (`fromStage` ➔ `toStage`), action (`create`, `advance`, `reject`), notes, and exact timestamp. Configured with `onDelete: NoAction` ensuring audit integrity.
- **PostgreSQL `pg_trgm` Fuzzy Matching**: Direct trigram similarity indexes (`similarity(name, query) >= 0.25`, `similarity(vacancy, ...)`, and `similarity(location, ...)`) allow typo resolution (e.g. `Priya Sharam` $\rightarrow$ `Priya Sharma`) at the database index layer without hardcoded dictionary maps.

### 3.4. NLP & Natural Language Search Pipeline
- **Role Isolation**: The LLM acts strictly as a query interpreter and search plan synthesizer. The LLM never hallucinates candidates or invents database rows. PostgreSQL performs retrieval, filtering, and ranking.
- **Operator-Driven Filters**: Supports comparison operators (`gt`, `gte`, `lt`, `lte`, `eq`) for stage duration and experience.
- **Timezone-Aware Date Resolution**: Relative date phrases (`today`, `yesterday`, `Monday`, `last week`, `10 September`) are resolved deterministically into ISO timestamps within Asia/Kolkata (IST UTC+5:30) context.
- **Stage vs. History Separation**: Distinguishes current stage (`currentStage`) from historical transitions (`movedToStage` + `movedSince`) and non-reached stages (`notReachedStage`).
- **Dynamic Contextual Suggestions**: Generates 2–3 actionable, natural search queries directly relevant to the recruiter's input.
- **Relaxed Text Fallback**: If strict search produces zero results, text fields are automatically relaxed while hard stage, experience, and history filters remain strictly enforced.

---

## 4. Key Architectural Trade-offs & Decisions

1. **Pure LLM Intent Parsing (Groq) vs. Offline Regex**:
   - *Decision*: Adopted a single, robust LLM-driven JSON schema extractor over rule-based keyword regex.
   - *Rationale*: Recruiter queries are naturally ambiguous and phrase-diverse. Groq's high-speed inference (<250ms) makes offline regex obsolete while eliminating brittle code maintenance.
2. **PostgreSQL Trigram Similarity (`pg_trgm`) vs. Vector DB / Hardcoded Dictionaries**:
   - *Decision*: Use PostgreSQL's native `pg_trgm` extension for typo tolerance and candidate scoring.
   - *Rationale*: Solves real-world typos natively at the database level with index acceleration, avoiding vector database overhead for basic keyword typo matching.
3. **Immutable Audit Log Table vs. Column History**:
   - *Decision*: Independent append-only `candidate_history` table.
   - *Rationale*: Compliance and legal defensibility in recruitment require unalterable history logs.
4. **Optimistic UI vs. Blocking Sequential Calls**:
   - *Decision*: Immediate state updates upon stage movement with background sync.
   - *Rationale*: Eliminates 2-second UI freezes during candidate advancement, providing a snappy, modern desktop-class user experience.

---

## 5. Security & Reliability
- **SQL Injection Prevention**: Tagged template literals (`prisma.$queryRaw\`...\``) and Prisma query validation prevent any arbitrary SQL execution.
- **Prompt Injection Defense**: User queries are safely delimited via `JSON.stringify(query.trim())`.
- **Soft Deletion**: Candidates are never hard-deleted; `isArchived = true` preserves historic candidate records.
- **CORS & Environment Isolation**: Strict CORS settings and environment variable segregation for database and Groq AI keys.
