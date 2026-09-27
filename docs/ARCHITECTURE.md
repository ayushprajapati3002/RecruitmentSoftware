# Architecture & System Design Document
## Recruitment Candidate Management & AI Search Platform

**Author:** Project Engineering Team  
**GitHub Repository:** [https://github.com/ayushprajapati3002/RecruitmentSoftware](https://github.com/ayushprajapati3002/RecruitmentSoftware)  
**Date:** September 2026  

---

## 1. Executive Summary
The **Recruitment Candidate Management System** is a full-stack platform designed to streamline hiring workflows, candidate progression tracking, and natural-language pipeline querying. Built with a modern micro-monorepo architecture using React 19, Node.js (Express 5), PostgreSQL via Prisma, and Groq-accelerated Llama-3.3-70B, the application provides instantaneous candidate stage transitions, audit trail immutability, and natural language recruiter search without regex fragility.

---

## 2. High-Level Architecture

```
+-------------------------------------------------------------------------+
|                              CLIENT LAYER                               |
|                  React 19 + TypeScript + Vite                           |
|        - Candidate Pipeline Board & Stage Progression                   |
|        - Natural Language Search Bar with Query Parsing Explanation     |
|        - Fully Responsive Ergonomic Interface (Desktop / Foldable)     |
+------------------------------------+------------------------------------+
                                     | HTTP REST (JSON)
                                     v
+-------------------------------------------------------------------------+
|                               API LAYER                                 |
|                       Express 5 on Node.js v24                          |
|   /api/candidates           /api/search               /uploads          |
|   - CRUD Candidate Data     - NLP Pipeline Controller - Static Resumes  |
|   - Stage Advance/Reject    - Groq SDK Interface                        |
+-------------------+--------------------------------+--------------------+
                    |                                |
       Raw SQL /    |                                | Structured
       Prisma ORM   |                                | Prompt / JSON
                    v                                v
+---------------------------------+  +------------------------------------+
|         DATABASE LAYER          |  |             AI LAYER               |
|      PostgreSQL Database        |  |     Groq Cloud (Llama-3.3-70B)     |
|  - candidates (Indexed)         |  | - Intent Classification            |
|  - candidate_history (Immutable)|  | - Structured JSON Filter Synthesis |
|  - Soft-delete flag (isArchived)|  | - <250ms Token Generation Latency  |
+---------------------------------+  +------------------------------------+
```

---

## 3. Core Architectural Modules

### 3.1. Frontend Architecture (React 19 & TypeScript)
- **State Flow**: Centralized reactive state in `App.tsx` handles active candidate selection, search filters, and quick stage movements.
- **Responsiveness**: Pure Vanilla CSS implementation avoiding heavy utility libraries. Utilizes modern CSS Grid and Flexbox with granular breakpoints to support ultra-narrow mobile viewports, dual-screen foldables, and wide desktop dashboards.
- **Micro-interactions**: Instant feedback on candidate stage advance/rejection, responsive drawer modals for full dossiers, and real-time validation.

### 3.2. Backend & API Services (Express 5)
- **Controller-Service Pattern**: Clear separation of HTTP concerns (`candidateController`, `searchController`) from business logic and query extraction (`nlpService`, `searchService`).
- **File Ingestion**: Multer-backed storage with unique timestamped file hashing for candidate resumes with direct file download capabilities.
- **Robust Error Handling**: Centralized Express 5 error handling middleware guaranteeing uniform JSON error responses and HTTP status semantics.

### 3.3. Database Architecture (PostgreSQL & Prisma)
- **`candidates` Model**: Stores all core candidate metadata (contact, skills array, vacancy, resume URL, experience, current stage, soft delete state).
- **`candidate_history` Model**: An append-only audit log tracking every candidate status transition (`fromStage` ➔ `toStage`), action (`create`, `advance`, `reject`), notes, and exact timestamp. Configured with `onDelete: NoAction` ensuring audit integrity.
- **Search Optimization**: Normalized phone search (`phone_normalized`) and indexed candidate fields for low-latency queries.

### 3.4. NLP & Natural Language Search Pipeline
- **Intent Extraction**: Recruiter queries like *"candidates with 3+ years experience in React currently in Interview"* are processed by Groq Llama-3.3-70B.
- **Deterministic JSON Schema**: The model returns a typed schema with specific filters (`experienceMin: 3`, `skillsQuery: "React"`, `currentStage: "Interview"`).
- **Safe SQL Translation**: Structured filters are converted into parameterized SQL statements with safe binding parameters to prevent SQL injection while maintaining flexibility.

---

## 4. Key Architectural Trade-offs & Decisions

1. **Groq Llama-3.3-70B vs. Offline Regex Parsing**:
   - *Decision*: Adopted a single, robust LLM-driven JSON schema extractor over rule-based keyword regex.
   - *Rationale*: Recruiter queries are naturally ambiguous and phrase-diverse. Groq's high-speed inference (<250ms) makes offline regex obsolete while eliminating brittle code maintenance.
2. **Immutable Audit Log Table vs. Column History**:
   - *Decision*: Independent append-only `candidate_history` table.
   - *Rationale*: Compliance and legal defensibility in recruitment require unalterable history logs.
3. **Static File Uploads vs. Database Blob Storage**:
   - *Decision*: Multi-part disk uploads served via static Express middleware.
   - *Rationale*: Keeps database payloads lightweight and database backups fast.

---

## 5. Security & Reliability
- **SQL Injection Prevention**: Parameterized queries and Prisma query validation prevent any arbitrary SQL execution.
- **Soft Deletion**: Candidates are never hard-deleted; `isArchived = true` preserves historic candidate records.
- **CORS & Environment Isolation**: Strict CORS settings and environment variable segregation for database and third-party AI keys.
