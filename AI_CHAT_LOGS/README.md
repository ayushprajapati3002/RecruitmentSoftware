# AI Chat Logs & Collaboration Audit

## Overview
This directory contains the chat transcripts and architectural discussions between the engineer and the AI assistant during the design and development of the **Recruitment Management System**.

## Contents
1. **[SESSION_HISTORY.md](./SESSION_HISTORY.md)**:
   - Full record of prompt interactions, iterations, and problem resolutions.
   - Covers responsive layout debugging across foldables/mobile screens, UI density enhancements, Groq Llama-3 NLP integration, SQL query pipeline optimizations, and pipeline stage transition handling.
2. **Key Disagreement & Technical Divergence Case Study**:
   - Detailed below and documented in the main `README.md`.

---

## Technical Disagreement Case Study: Rule-Based Offline Regex vs. Pure LLM Extraction

### The AI's Initial Proposal:
During the natural language search implementation, the AI initially attempted to implement a **dual-tier rule-based regex and keyword parser** as Step 1 ("Offline Rule-Based NLP") prior to calling the LLM. 
The AI suggested parsing queries with regex strings like:
```typescript
const stageRegex = /(applied|screening|interview|offer|hired)/i;
const expRegex = /(\d+)\+?\s*years?/i;
```

### The Engineer's Disagreement & Correction:
The engineer explicitly rejected this offline regex approach:
> *"Don't want this Step 1: Offline Rule-Based NLP. Remove the changes of step 1 only."*

### Why the Engineer Disagreed:
1. **Brittleness and Language Variance**:
   - Natural recruiter queries rarely follow rigid syntax. A query like *"candidates with solid frontend background stuck in screening for more than 2 weeks"* breaks simplistic regex without exhaustive phrase rules.
2. **Contextual Loss**:
   - Keyword matching confuses filters (e.g. matching "hired" inside candidate notes or previous job titles rather than the pipeline stage).
3. **Double Maintenance Burden**:
   - Maintaining both a fragile regex rule-book and an LLM pipeline introduces duplicate parsing logic, inconsistent filtering semantics, and testing overhead.
4. **Architectural Solution Adopted**:
   - Unified on a zero-overhead, highly fast LLM extractor via **Groq (`llama-3.3-70b-versatile` / `llama3-70b-8192`)** with strict JSON schema output and deterministic database SQL query construction.
   - Fast inference (<200ms latency) guarantees speed without sacrificing contextual semantic understanding.
